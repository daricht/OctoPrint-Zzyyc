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


        self.trace = function () {
            console.log("##trace");
            // initialize starting point
            self.checkPositionInterval = setInterval(self.checkPosition, 1000); // fix make checkPosition call next steps if we reached our target
            self.initStartPoint();
            // loop over the grid
            self.loopGrid();
            console.log("//trace")
            clearInterval(self.checkPositionInterval);
        }

        self.initStartPoint = function () {
            console.log("##initStartPoint");
            self.suppressTempMsg();
            self.setAndSendGcode("G90 ;absolute Positioning");
            //self.terminal.setAndSendGcode("G91 ;relative Positioning");
            self.setAndSendGcode("G92 X0 Y0 Z0 ;set Zero");
            self.setAndSendGcode("G0 Z" + 1 * parseInt(self.input_lift_z()));
            self.setAndSendGcode("G38.3 Z-" + 5 * parseInt(self.input_lift_z()) + " F" + parseInt(self.input_feedrate_probe()));
            console.log("//initStartPoint")
        }

        self.loopGrid = function () {
            console.log("##loopGrid")
            //for loop over y and x coordinates
            // var x_bound = parseInt(self.input_size_x());
            // var y_bound = parseInt(self.input_size_y());
            // if (self.target_x ) {
                
            // }


            for (var y = 0; y <= parseInt(self.input_size_y()); y += parseInt(self.input_stepsize_y())) {
                for (var x = 0; x <= parseInt(self.input_size_x()); x += parseInt(self.input_stepsize_x())) {
                    // the first position with this loop is: x=0, y=0
                    // move to next position
                    self.moveOnGrid(x, y);
                    // probe
                    self.probe();

                }
                // // move to next line
                self.setAndSendGcode("G0 Z" + parseInt(self.input_max_z()));
                // self.setAndSendGcode("G0 Y"+self.input_stepsize_y());
            }
            console.log("//loopGrid")
        }

        self.probe = function () {
            console.log("##probe")
            self.setAndSendGcode("G38.3 Z-" + 5 * parseInt(self.input_lift_z()) + " F" + parseInt(self.input_feedrate_probe()));
            console.log("//probe")
        }

        self.moveOnGrid = function (x, y, retries = 100) {
            console.log("##moveOnGrid")
            // move to next position
            if (self.current_x == x && self.current_y == y) {
                console.log("already at position x:" + self.current_x + ", y:" + self.current_y)
                return;
            }
            if (self.moveOngoing) {
                if (retries <= 0) {
                    console.log("moveOngoing=true, retries exhausted")
                    return;
                }
                console.log("moveOngoing=true, waiting 200ms and trying again")
                // setTimeout(() => self.moveOnGrid(x, y, retries - 1), 200);
                setTimeout(self.moveOnGrid, 200, x, y, retries - 1);
                return;
            }
            self.setAndSendGcode("G0 Z" + parseInt(self.input_lift_z()));
            self.setAndSendGcode("G38.3 X" + x + " Y" + y + " F" + parseInt(self.input_feedrate_probe()));
            console.log("//moveOnGrid")

        }

        self.checkPosition = function () {
            var Output = self.terminal.displayedLines()
            var x_reported = 0;
            var y_reported = 0;
            var z_reported = 0;
            console.log("##check_position")
            for (let index = 1; index < 10; index++) {
                var currentLine = Output[Output.length - index].line;
                var currentLineType = self.getLineType(currentLine);
                switch (currentLineType) {
                    case "counter":
                        var currentCount = parseInt(currentLine.substring(currentLine.indexOf("Counter:") + 8, currentLine.length));
                        if (self.lastCounterRecvd < currentCount) { //if its a position report save the position
                            self.lastCounterRecvd = currentCount;
                            //CONTINUE WITH NEXT ROW ABOVE IN WHILE LOOP
                        } else {
                            console.log("//checkPosition counter has been read before")
                            return "counterFound";
                        }
                        break;
                    case "position":
                        if (currentLine.indexOf("Recv: X:") !== -1) { //if its a position report save the position
                            x_reported = currentLine.substring(8, currentLine.indexOf(" Y:"));
                            y_reported = currentLine.substring(currentLine.indexOf(" Y:") + 3, currentLine.indexOf(" Z:"));
                            z_reported = currentLine.substring(currentLine.indexOf(" Z:") + 3, currentLine.indexOf(" E:"));
                            self.moveOngoing = false;
                            self.current_x = x_reported;
                            self.current_y = y_reported;
                            self.current_z = z_reported;
                            console.log("//checkPosition x:" + self.current_x + ", y:" + self.current_y + ", z:" + self.current_z + "")
                            return "positionFound";
                        }
                }


            }
            console.log("//check_position")
        }

        self.getLineType = function (line) {
            var currentLineType = "";
            if (line.indexOf("Recv: ok") !== -1) { currentLineType = "ok" } else {
                if (line.indexOf("Send: ") !== -1) { currentLineType = "send" } else {
                    if (line.indexOf("Recv: Counter:") !== -1) { currentLineType = "counter" } else {
                        if (line.indexOf("Recv: X:") !== -1) { currentLineType = "position" }
                    }
                }
            }
            return currentLineType;
        }

        self.suppressTempMsg = function () {
            console.log("##suppressTempMsg")
            self.setAndSendGcode("M155 S60");
            console.log("//suppressTempMsg")
        }

        self.getCommandType = function (command) {
            var currentCommandType = "";
            var zmove = false;
            if (command.indexOf("G0") !== -1) { currentCommandType = "move" } else {
                if (command.indexOf("G1") !== -1) { currentCommandType = "move" } else {
                    if (command.indexOf("G38") !== -1) { currentCommandType = "probe" }
                }
            }
            if (command.indexOf("Z") !== -1) { zmove = true }
            return [currentCommandType, zmove];
        }

        //gcode as string, relative as boolean
        self.setAndSendGcode = function (gcode) {
            [currentCommandType, zmove] = self.getCommandType(gcode);
            switch (currentCommandType) {
                case "move":
                    if (zmove == true) {
                        self.terminal.command("G91");
                        self.terminal.sendCommand();
                    }
                    self.move_ongoing = true;
                    self.SendCounter();
                    console.log("##setAndSendGcode: " + gcode)
                    self.terminal.command(gcode);
                    self.terminal.sendCommand();
                    if (zmove == true) {
                        self.terminal.command("G90");
                        self.terminal.sendCommand();
                    }
                    self.waitForPosition();
                    break;
                case "probe":
                    if (zmove == true) {
                        self.terminal.command("G91");
                        self.terminal.sendCommand();
                    }

                    self.move_ongoing = true;
                    self.SendCounter();
                    console.log("##setAndSendGcode: " + gcode)
                    self.terminal.command(gcode);
                    self.terminal.sendCommand();
                    if (zmove == true) {
                        self.terminal.command("G90");
                        self.terminal.sendCommand();
                    }

                    self.waitForPosition();
                    break;
                default:
                    self.SendCounter();
                    console.log("##setAndSendGcode: " + gcode)
                    self.terminal.command(gcode);
                    self.terminal.sendCommand();
            }
            console.log("//setAndSendGcode")

        }

        self.waitForPosition = function () {
            self.SendCounter();
            self.terminal.command("M114")
            self.terminal.sendCommand()
            self.waitForResponse()
        }

        self.waitForResponse = function () {
            if (self.checkPosition() !== "positionFound") {
                setTimeout(self.waitForResponse, 200)
            }
            // while (self.checkPosition() !== "positionFound") {
            //     self.waitForResponse()
            // }
        }

        self.SendCounter = function () {
            self.terminal.command("M118 Counter:" + self.counter);
            self.terminal.sendCommand()
            self.counter = self.counter + 1;
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
            clearInterval(self.checkPositionInterval);
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


