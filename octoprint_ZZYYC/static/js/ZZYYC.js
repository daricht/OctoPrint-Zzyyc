$(function () {
    function ZzyycViewModel(parameters) {
        var self = this;
        self.loginState = parameters[0];
        self.terminal = parameters[1];
        self.settings = parameters[2];

        self.isCalculating = ko.observable(false);

        self.input_size_x = ko.observable("3");
        self.input_size_y = ko.observable("3");
        self.input_max_z = ko.observable("30");
        self.input_stepsize_x = ko.observable("1");
        self.input_stepsize_y = ko.observable("1");
        self.input_lift_z = ko.observable("1");
        self.input_feedrate_probe = 300; // feedrate for probing in mm/min but this is usually overwritten by the maschines so here its just used for counting
        self.input_feedrate_move = 300;
        self.input_wait_time = ko.observable("30"); // time to wait for a response from the printer in seconds
        self.input_tolerance = ko.observable("0.08"); // tolerance for reaching the target position
        self.input_logging = ko.observable("false"); // if true, the plugin will log all the messages to the console
        //    <input type="text" id="prescan_factor" name="prescan_factor" data-bind="value: input_prescan_factor, disable: isCalculating" title="factor between the fine (final) and coarse prescan grid density.">
        self.input_prescan_factor = ko.observable("2");

        self.input_z_deviation = ko.observable("0.5"); // acceptible deviation between points around a target
        self.input_z_deviation_from_zero = ko.observable("0.5"); // acceptable deviation of the cornerpoints and zero

        self.current_x = -1;
        self.current_y = -1;
        self.current_z = -1;

        self.target_x = -1;
        self.target_y = -1;
        self.target_z = -1;

        self.PointCloud = []; //pointcloud variable to store the points after each probe hit

        self.moveOngoing = false; // this is set to true when a move Gcode is sent to the printer and set to false after each M114 response that is captured
        self.moveTime = parseInt(self.input_wait_time()) * 1000; // this is the time in seconds that the printer has to respond to a M114 command after a move Gcode was sent
        self.checkPositionInterval = 0; //the interval is saved here so it can be stopped later

        self.lastCounterSent = 0;
        self.lastCounterRecvd = -1;
        self.last_z_height = 0;

        self.probe = async function () {
            self.debuggingLog("##probe");
            self.resetStartingValues();
            // Validate input values
            self.isCalculating(true);
            const maxZ = parseInt(self.input_max_z());
            const liftZ = parseInt(self.input_lift_z());
            if (maxZ <= liftZ) {
                alert("Max Z must be bigger than lift Z");
                return;
            }

            //prescan grid
            await self.gridLoop(parseInt(self.input_size_x()), parseInt(self.input_size_y()), parseInt(self.input_stepsize_x()) * parseInt(self.input_prescan_factor()), parseInt(self.input_stepsize_y()) * parseInt(self.input_prescan_factor()), maxZ);

            //fine grid
            await self.gridLoop(parseInt(self.input_size_x()), parseInt(self.input_size_y()), parseInt(self.input_stepsize_x()), parseInt(self.input_stepsize_y()), maxZ, true);

            self.downloadPointCloud(self.PointCloud);
            self.isCalculating(false);
        }



        self.gridLoop = async function (size_x, size_y, stepsize_x, stepsize_y, maxZ, finescan = false, prescan_factor) {
            // Loop over the grid
            for (let y = 0; y <= size_y; y += stepsize_y) {
                for (let x = 0; x <= size_x; x += stepsize_x) {

                    if (finescan==true){// if pointcloud contains a point with the same x and y coordinates then skip this point
                    if (self.PointCloud.some(e => e.x === x && e.y === y)) {
                        // skip this point
                        continue;
                    }
                    // round down x and y to the nearest stepsize
                    x_lower = Math.floor(x / prescan_factor) * prescan_factor;
                    y_lower = Math.floor(y / prescan_factor) * prescan_factor;
                    // round up x and y to the nearest stepsize
                    x_upper = Math.ceil(x / prescan_factor) * prescan_factor;
                    y_upper = Math.ceil(y / prescan_factor) * prescan_factor;

                    // find the 4 points in the pointcloud that are closest to the target point
                    cornerpoints = self.PointCloud.filter(e => (e.x === x_lower && e.y === y_lower) || (e.x === x_lower && e.y === y_upper) || (e.x === x_upper && e.y === y_lower) || (e.x === x_upper && e.y === y_upper));
                    // if there are less than 4 points in the pointcloud then make the missing points z height = 0
                    if (cornerpoints.length > 4) {
                        //throw error
                        alert("Error: more than 4 points found in the pointcloud");
                        return;
                    }
                    if (cornerpoints.length < 4) {
                        // for (i = 0; i < 4 - cornerpoints.length; i++) {
                        while (cornerpoints.length < 4) {
                            cornerpoints.push({ x: 0, y: 0, z: 0 });
                        }
                    }
                    //compare z heights of the 4 points. if they are all within 'z-deviation' then skip this point
                    //if (point1.z - point2.z < self.input_z_deviation() && point1.z - point3.z < self.input_z_deviation() && point1.z - point4.z < self.input_z_deviation() && Math.abs(point1.z)<self.input_z_deviation_from_zero() ) {
                    if (Math.abs(cornerpoints[0].z - cornerpoints[1].z) < self.input_z_deviation() && Math.abs(cornerpoints[0].z - cornerpoints[2].z) < self.input_z_deviation() && Math.abs(cornerpoints[0].z - cornerpoints[3].z) < self.input_z_deviation() && Math.abs(cornerpoints[0].z) < self.input_z_deviation_from_zero()) {
                    // skip this point
                        continue;
                    }}

                    await self.moveOnGrid(x, y);
                    // Do probe
                    nextCommand = `G38.3 Z-${5 * parseInt(self.input_lift_z())} F${parseInt(self.input_feedrate_probe) + parseInt(self.lastCounterSent)}`
                    self.lastCounterSent++;
                    var last_hit = await self.setAndSendGcode(nextCommand);
                    self.last_z_height = last_hit.z;
                    self.PointCloud.push(last_hit);
                }

                // Move to next line
                self.setAndSendGcode(`G0 Z${maxZ}`);
                await self.setAndSendGcode(`G38.3 X0 Y${y + stepsize_y}`);
            }
        }

        self.moveOnGrid = async function (x, y) {
            self.debuggingLog("##moveOnGrid");
            // Move to next position
            tries = 0;
            while (self.current_x !== x || self.current_y !== y) {
                // self.lastCounterSent++;
                self.debuggingLog(`Moving up to Z:${parseFloat(self.input_lift_z()) + self.last_z_height + tries * parseFloat(self.input_lift_z())}`);
                await self.setAndSendGcode(`G0 Z${parseFloat(self.input_lift_z()) + self.last_z_height + tries * parseFloat(self.input_lift_z())}`);
                newCommand = `G38.3 X${x} Y${y} F${parseInt(self.input_feedrate_probe) + parseInt(self.lastCounterSent)}`
                self.lastCounterSent++;
                var xy_return = await self.setAndSendGcode(newCommand);

                if (Math.abs(x - xy_return.x) > parseFloat(self.input_tolerance()) || Math.abs(y - xy_return.y) > parseFloat(self.input_tolerance())) { // if the position is not reached, try again
                    self.debuggingLog(`XYZ: ${xy_return.x}, ${xy_return.y}, ${xy_return.z} tolerance exceeded, restarting moveOnGrid, tries: ${tries}`);
                    tries++;
                } else { // if the position is reached, set the current position and break the loop
                    self.current_x = x;
                    self.current_y = y;
                    self.debuggingLog(`Reached position x:${x}, y:${y}`);
                    break;
                }
            }
            self.debuggingLog(`Already at position x:${x}, y:${y}`);
        }

        self.setAndSendGcode = function (code) {
            self.debuggingLog(`##setAndSendGcode: ${code}`);
            // remove gcode comments including the single preceding space
            code = code.replace(/;.*$/, "").replace(/\s$/, "");
            self.terminal.command(code);
            self.terminal.sendCommand();
            self.terminal.command("M114");
            self.terminal.sendCommand();

            function checkResponse(resolve, reject) {
                self.debuggingLog("##checkResponse")
                const output = self.terminal.displayedLines();
                let originalLineIndex = -1;

                for (let i = output.length - 1; i >= 0; i--) {
                    if (output[i].line.includes(code)) { //find original command
                        originalLineIndex = i;
                        break;
                    }
                }

                if (originalLineIndex === -1) { //if not found, wait and try again
                    self.debuggingLog("originalLineIndex === -1 -> command was not found in the terminal output, will wait and try again");
                    return;
                }

                let okReceivedLineIndex = -1;
                for (let i = originalLineIndex; i < output.length; i++) { //find ok response to original command
                    if (output[i].line.includes("Recv: ok")) {
                        okReceivedLineIndex = i;
                        self.debuggingLog("ok Received LineIndex: " + okReceivedLineIndex);
                        break;
                    }
                }

                for (let i = originalLineIndex; i < output.length; i++) { //find Coordinates-Response to original command
                    if (output[i].line.includes("Recv: X:") || output[i].line.includes("Recv: ok X:")) {
                        self.debuggingLog("Coordinates-Response LineIndex: " + i);
                        const x = parseFloat(output[i].line.match(/X:(-?\d+\.\d+)/)[1]);
                        const y = parseFloat(output[i].line.match(/Y:(-?\d+\.\d+)/)[1]);
                        const z = parseFloat(output[i].line.match(/Z:(-?\d+\.\d+)/)[1]);
                        if (z == 2) {
                            self.debuggingLog("z==2")
                        }
                        resolve({ x, y, z });
                        return;
                    }
                }

                if (okReceivedLineIndex === -1) {
                    self.debuggingLog("okReceivedLineIndex === -1 -> ok was not received, will wait and try again");
                    return;
                }

                self.terminal.command("M114");
                self.terminal.sendCommand();
            }

            return new Promise((resolve, reject) => {
                const intervalId = setInterval(() => {
                    checkResponse(resolve, reject);
                }, 100);

                setTimeout(() => {
                    clearInterval(intervalId);
                    reject(new Error("Timeout"));
                }, self.moveTime); // Timeout after 5 seconds
            });
        }

        self.lowerZ = function () {
            //set 0
            self.suppressTempMsg();
            self.setAndSendGcode("G90 ;absolute Positioning");
            self.setAndSendGcode("G92 X0 Y0 Z0 ;set Zero");
            self.setAndSendGcode("G38.3 Z-" + 2 * parseInt(self.input_max_z()));
            self.setAndSendGcode("G92 Z0 ;set Zero");
        }

        self.GoXYZero = function () {
            // move up on z axis
            self.setAndSendGcode("G91 ;relative Positioning");
            self.setAndSendGcode("G0 Z1");
            self.setAndSendGcode("G90 ;absolute Positioning");
            self.setAndSendGcode("G38.3 X0 Y0");
        }

        self.moveUp = function () {
            self.setAndSendGcode("G91 ;relative Positioning");
            self.setAndSendGcode("G0 Z1");
            self.setAndSendGcode("G90 ;absolute Positioning");
        }

        self.zeroxy = function () {
            self.setAndSendGcode("G92 X0 Y0 ;set Zero");
        }

        self.suppressTempMsg = function () {
            self.debuggingLog("##suppressTempMsg")
            self.setAndSendGcode("M155 S60");
            self.debuggingLog("//suppressTempMsg")
        }

        self.debuggingLog = function (msg) {
            if (Boolean(self.input_logging()) == true) {
                console.log(msg);
            }
        }

        self.resetStartingValues = function () {
            self.PointCloud = [];
            self.lastCounterSent = 0;
            self.lastCounterRecvd = -1;
        }

        self.downloadPointCloud = function (pointCloud) {
            // Convert the point cloud array to a string
            const pointCloudString = JSON.stringify(pointCloud);

            // Create a Blob with the string data
            const blob = new Blob([pointCloudString], { type: 'application/json' });

            // Create a download link
            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(blob);
            downloadLink.download = 'pointCloud.json';

            // Click the download link to initiate the download
            downloadLink.click();
        }
    }
    /* view model class, parameters for constructor, container to bind to
     * Please see http://docs.octoprint.org/en/master/plugins/viewmodels.html#registering-custom-viewmodels for more details
     * and a full list of the available options.
     */
    OCTOPRINT_VIEWMODELS.push({
        construct: ZzyycViewModel,
        // ViewModels your plugin depends on, e.g. loginStateViewModel, settingsViewModel, ...
        dependencies: ["loginStateViewModel", "terminalViewModel", "settingsViewModel"],
        // Elements to bind to, e.g. #settings_plugin_ZZYYC, #tab_plugin_ZZYYC, ...
        elements: ["#tab_plugin_ZZYYC" /* ... */]
    });
});