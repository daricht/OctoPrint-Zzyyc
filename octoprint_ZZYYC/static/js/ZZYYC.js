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

        self.current_x = -1;
        self.current_y = -1;
        self.current_z = -1;

        self.target_x = -1;
        self.target_y = -1;
        self.target_z = -1;

        //pointcloud variable to store the points after each probe hit
        self.PointCloud = [];

        self.moveOngoing = false; // this is set to true when a move Gcode is sent to the printer and set to false after each M114 response that is captured
        self.moveTime =parseInt(self.input_wait_time())*1000; // this is the time in seconds that the printer has to respond to a M114 command after a move Gcode was sent
        self.checkPositionInterval = 0; //the interval is saved here so it can be stopped later

        self.lastCounterSent = 0;
        self.lastCounterRecvd = -1;
        self.last_z_height = 0;

        // todo: add validation for the input values, that can be skipped with an ok button. for example max z should be bigger that lift z

        self.trace = async function () {
            console.log("##trace");
            self.PointCloud = [];
            self.lastCounterSent = 0;
            self.lastCounterRecvd = -1;
            // Validate input values
            self.isCalculating(true);
            self.PointCloud = [];
            const maxZ = parseInt(self.input_max_z());
            const liftZ = parseInt(self.input_lift_z());
            if (maxZ <= liftZ) {
                alert("Max Z must be bigger than lift Z");
                return;
            }

            // Loop over the grid
            for (let y = 0; y <= parseInt(self.input_size_y()); y += parseInt(self.input_stepsize_y())) {
                for (let x = 0; x <= parseInt(self.input_size_x()); x += parseInt(self.input_stepsize_x())) {
                    // Move to next position
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
                await self.setAndSendGcode(`G38.3 X0 Y${y + parseInt(self.input_stepsize_y())}`);
            }
            self.downloadPointCloud(self.PointCloud);
            self.isCalculating(false);
        }

        self.moveOnGrid = async function (x, y) {
            console.log("##moveOnGrid");
            // Move to next position
            tries = 0;
            while (self.current_x !== x || self.current_y !== y) {
                // self.lastCounterSent++;
                //todo use the above mentioned variable to imitate relative z movement without setting G91
                console.log(`Moving up to Z:${parseFloat(self.input_lift_z()) + self.last_z_height + tries * parseFloat(self.input_lift_z())}`);
                await self.setAndSendGcode(`G0 Z${parseFloat(self.input_lift_z()) + self.last_z_height + tries * parseFloat(self.input_lift_z())}`);
                newCommand = `G38.3 X${x} Y${y} F${parseInt(self.input_feedrate_probe) + parseInt(self.lastCounterSent)}`
                self.lastCounterSent++;
                var xy_return = await self.setAndSendGcode(newCommand);
                if (Math.round(xy_return.x*10)/10 !== x || Math.round(xy_return.y*10)/10 !== y) { // if the position is not reached, try again
                    console.log(`XYZ: ${xy_return.x}, ${xy_return.y}, ${xy_return.z} not reached, restarting moveOnGrid, tries: ${tries}`);
                    tries++;
                } else { // if the position is reached, set the current position and break the loop
                    self.current_x = x;
                    self.current_y = y;
                    console.log(`Reached position x:${x}, y:${y}`);
                    break;
                }
            }
            console.log(`Already at position x:${x}, y:${y}`);
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
            console.log("##suppressTempMsg")
            self.setAndSendGcode("M155 S60");
            console.log("//suppressTempMsg")
        }

        self.setAndSendGcode = function (code) {
            console.log(`##setAndSendGcode: ${code}`);
            // remove gcode comments including the single preceding space
            code = code.replace(/;.*$/, "").replace(/\s$/, "");
            self.terminal.command(code);
            self.terminal.sendCommand();
            self.terminal.command("M114");
            self.terminal.sendCommand();
        
            function checkResponse(resolve, reject) {
                console.log("##checkResponse")
                const output = self.terminal.displayedLines();
                let originalLineIndex = -1;
        
                for (let i = output.length - 1; i >= 0; i--) {
                    if (output[i].line.includes(code)) { //find original command
                        originalLineIndex = i;
                        break;
                    }
                }
        
                if (originalLineIndex === -1) { //if not found, wait and try again
                    console.log("originalLineIndex === -1 -> command was not found in the terminal output, will wait and try again");
                    return;
                }
        
                let okReceivedLineIndex = -1;
                for (let i = originalLineIndex; i < output.length; i++) { //find ok response to original command
                    if (output[i].line.includes("Recv: ok")) {
                        okReceivedLineIndex = i;
                        console.log("ok Received LineIndex: " + okReceivedLineIndex);
                        break;
                    }
                }
        
                for (let i = originalLineIndex; i < output.length; i++) { //find Coordinates-Response to original command
                    if (output[i].line.includes("Recv: X:") || output[i].line.includes("Recv: ok X:")) {
                        console.log("Coordinates-Response LineIndex: " + i);
                        const x = parseFloat(output[i].line.match(/X:(-?\d+\.\d+)/)[1]);
                        const y = parseFloat(output[i].line.match(/Y:(-?\d+\.\d+)/)[1]);
                        const z = parseFloat(output[i].line.match(/Z:(-?\d+\.\d+)/)[1]);
                        if (z==2){
                            console.log("z==2")
                        }
                        resolve({ x, y, z });
                        return;
                    }
                }
        
                if (okReceivedLineIndex === -1) { 
                    console.log("okReceivedLineIndex === -1 -> ok was not received, will wait and try again");
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


