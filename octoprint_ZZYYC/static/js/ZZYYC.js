$(function () {
    function ZzyycViewModel(parameters) {
        var self = this;
        self.loginState = parameters[0];
        self.terminal = parameters[1];
        self.settings = parameters[2];

        self.input_size_x = ko.observable("3");
        self.input_size_y = ko.observable("3");
        self.input_max_z = ko.observable("10");
        self.input_stepsize_x = ko.observable("1");
        self.input_stepsize_y = ko.observable("1");
        self.input_lift_z = ko.observable("2");
        self.input_feedrate_probe = ko.observable("300"); // feedrate for probing in mm/min
        self.input_feedrate_move = ko.observable("300");
        self.input_wait_time = ko.observable("10"); // time to wait for a response from the printer in seconds

        self.current_x = -1;
        self.current_y = -1;
        self.current_z = -1;

        self.target_x = -1;
        self.target_y = -1;
        self.target_z = -1;

        self.moveOngoing = false; // this is set to true when a move Gcode is sent to the printer and set to false after each M114 response that is captured

        self.checkPositionInterval = 0; //the interval is saved here so it can be stopped later

        self.counter = 0;
        self.lastCounterRecvd = -1;

        // todo: add validation for the input values, that can be skipped with an ok button. for example max z should be bigger that lift z

        function waitForPosition() {
            console.log("##waitForPosition");
            // fix this whole function doesnt really run async the whole gcode is generated at once which sucks
            return new Promise(resolve => {
                function getPosition(retries = 100) {
                    console.log("##getPosition");
                    const output = self.terminal.displayedLines();
                    for (let i = output.length - 1; i >= 0; i--) {
                        const line = output[i].line;
                        if (line.includes("Send: G38.3")) {
                            if (line.includes("F")) {
                                if (self.lastCounterRecvd == parseFloat(line.match(/F(\d+)/)[1]) - parseFloat(self.input_feedrate_probe())) {
                                    setTimeout(checkProbeResult, 100);
                                } else {
                                    self.lastCounterRecvd = parseFloat(line.match(/F(\d+)/)[1]) - parseFloat(self.input_feedrate_probe());
                                }
                            }
                        }
                        // depending on the printer the answer is "Recv: X:" or "Recv: ok X:"
                        if (line.includes("Recv: X:") || line.includes("Recv: ok X:")) {
                            const x = parseFloat(line.match(/X:(-?\d+\.\d+)/)[1]);
                            const y = parseFloat(line.match(/Y:(-?\d+\.\d+)/)[1]);
                            const z = parseFloat(line.match(/Z:(-?\d+\.\d+)/)[1]);
                            
                            resolve({ x, y, z });
                            return;
                        }
                    }
                    if (retries <= 0) {
                        setTimeout(getPosition, 100, retries--);
                    }
                }
                getPosition();
            });
        }

        // Create a promise that resolves when the probe is done
        function doProbe() {
            console.log("##doProbe")
            self.setAndSendGcode(`G38.3 Z-${5 * parseInt(self.input_lift_z())} F${parseInt(self.input_feedrate_probe()) + parseInt(self.counter)}`);
            self.counter++;
            return new Promise(resolve => {

                function checkProbeResult() {
                    const output = self.terminal.displayedLines();
                    for (let i = output.length - 1; i >= 0; i--) {
                        const line = output[i].line;
                        console.log("DoProbe_current line: "+line);
                        if (line.includes("Send: G38.3")) {
                            if (line.includes("F")) {
                                if (self.lastCounterRecvd == parseFloat(line.match(/F(\d+)/)[1]) - parseFloat(self.input_feedrate_probe())) {
                                    setTimeout(checkProbeResult, 100);
                                    return;
                                } else {
                                    self.lastCounterRecvd = parseFloat(line.match(/F(\d+)/)[1]) - parseFloat(self.input_feedrate_probe());
                                    setTimeout(checkProbeResult, 100);
                                    return;
                                }
                            }
                        }
                        if (line.includes("Recv: X:")) {
                            const x = parseFloat(line.match(/X:(-?\d+\.\d+)/)[1]);
                            const y = parseFloat(line.match(/Y:(-?\d+\.\d+)/)[1]);
                            const z = parseFloat(line.match(/Z:(-?\d+\.\d+)/)[1]);
                            resolve({ x, y, z });
                            return;
                        }
                    }
                    setTimeout(checkProbeResult, 100);
                }
                checkProbeResult();
            });
        }

        self.trace = async function () {
            // Validate input values
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
                    await doProbe();
                }

                // Move to next line
                self.setAndSendGcode(`G0 Z${maxZ}`);
            }
        }

        self.moveOnGrid = async function (x, y) {
            // Move to next position
            if (self.current_x === x && self.current_y === y) {
                console.log(`Already at position x:${x}, y:${y}`);
                return;
            }

            console.log(`Moving up to Z:${parseInt(self.input_lift_z())}`);
            await self.setAndSendGcode(`G0 Z${parseInt(self.input_lift_z())}`);
            console.log(`Moving to position x:${x}, y:${y}, F:${parseInt(self.input_feedrate_probe()) + parseInt(self.counter)}`);
            await self.setAndSendGcode(`G38.3 X${x} Y${y} F${parseInt(self.input_feedrate_probe()) + parseInt(self.counter)}`);
            self.counter++;
            var xy_return= await waitForPosition();
            self.current_x = x;
            self.current_y = y;
            console.log(`Reached position x:${x}, y:${y}`);
        }

        self.lowerZ = function () {
            //set 0
            self.suppressTempMsg();
            self.setAndSendGcode("G90 ;absolute Positioning");
            self.setAndSendGcode("G92 X0 Y0 Z0 ;set Zero");
            self.setAndSendGcode("G38.3 Z-" + 2 * parseInt(self.input_max_z()));
            self.setAndSendGcode("G92 Z0 ;set Zero");
        }

        self.stopPolling = function () {
            // clearInterval(self.checkPositionInterval);
        }

        self.suppressTempMsg = function () {
            console.log("##suppressTempMsg")
            self.setAndSendGcode("M155 S60");
            console.log("//suppressTempMsg")
        }

        // self.setAndSendGcode = function (code) {
        //     self.terminal.command(code);
        //     self.terminal.sendCommand();
        //     self.terminal.command("M114");
        //     self.terminal.sendCommand();
        //     return new Promise(resolve => {
        //         function checkResponse() {
        //             const output = self.terminal.displayedLines();
        //             const lastLine = output[output.length - 1].line;
        //             if (lastLine.includes("ok")) {
        //                 resolve();
        //             } else {
        //                 setTimeout(checkResponse, 100);
        //             }
        //         }
        //         checkResponse();
        //     });
        // }

        self.setAndSendGcode = function (code) {
            self.terminal.command(code);
            self.terminal.sendCommand();
            self.terminal.command("M114");
            self.terminal.sendCommand();
            return new Promise(resolve => {
                function checkResponse() {
                    const output = self.terminal.displayedLines();
                    let originalLineIndex = -1;
                    for (let i = output.length - 1; i >= 0; i--) {
                        if (output[i].line.includes(code)) {
                            originalLineIndex = i;
                            break;
                        }
                    }
                    if (originalLineIndex === -1) {
                        setTimeout(checkResponse, 100);
                        return;
                    }
                    let okReceivedLineIndex = -1;
                    for (let i = originalLineIndex; i < output.length; i++) {
                        // line.includes("Recv: X:") || line.includes("Recv: ok X:"
                        if (output[i].line.includes("ok")) {
                            okReceivedLineIndex = i;
                            break;
                        }
                    }
                    if (okReceivedLineIndex === -1) {
                        setTimeout(checkResponse, 100);
                        return;
                    }
                    resolve();
                }
                checkResponse();
            });
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


