/*
 * View model for OctoPrint-Zzyyc
 *
 * Author: You
 * License: AGPLv3
 */
$(function() {
    function ZzyycViewModel(parameters) {
        var self = this;
        self.loginState = parameters[0];
        self.terminal = parameters[1];
        self.settings =parameters[2];

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

        self.moveOngoing = false; // this is set to true when a move Gcode is sent to the printer and set to false after each M114 response that is captured

        self.checkPositionInterval=0;

        self.counter=0;
        self.lastCounterRecvd=-1;

// todo: add validation for the input values, that can be skipped with an ok button. for example max z should be bigger that lift z
        self.lowerZ = function() {
            //set 0
            self.suppressTempMsg();
            self.setAndSendGcode("G90 ;absolute Positioning");
            self.setAndSendGcode("G92 X0 Y0 Z0 ;set Zero");
            self.setAndSendGcode("G38.3 Z-"+2*self.input_max_z(),true);
            self.setAndSendGcode("G92 Z0 ;set Zero");
        }

        self.stopPolling = function() {
            clearInterval(self.checkPositionInterval);
        }

        self.trace = function() {
            console.log("##trace");
            // initialize starting point
            self.checkPositionInterval = setInterval(self.checkPosition, 1000);
// TODO Change this timing interval and undo the commentbbelow

            self.initStartPoint();
            // loop over the grid
            // self.loopGrid();
            console.log("//trace")
            clearInterval(self.checkPositionInterval);
		}

        self.initStartPoint=function() {
            console.log("##initStartPoint");
            self.suppressTempMsg();
            self.setAndSendGcode("G90 ;absolute Positioning");
            //self.terminal.setAndSendGcode("G91 ;relative Positioning");
            self.setAndSendGcode("G92 X0 Y0 Z0 ;set Zero");
            self.setAndSendGcode("G0 Z"+1*self.input_lift_z(),true);
            self.setAndSendGcode("G38.3 Z-"+5*self.input_lift_z()+" F"+self.input_feedrate_probe(),true);
            console.log("//initStartPoint")
        }

        self.loopGrid = function() {
            console.log("##loopGrid")
            //for loop over y and x coordinates
            for (var y = 0; y <= self.input_size_y(); y += self.input_stepsize_y()) {
                for (var x = 0; x <= self.input_size_x(); x += self.input_stepsize_x()) {
                    // the first position with this loop is: x=0, y=0
                    // move to next position
                    self.moveOnGrid(x,y);
                    // probe
                    self.probe();

                }
                // // move to next line
                self.setAndSendGcode("G0 Z"+self.input_max_z(),true);
                // self.setAndSendGcode("G0 Y"+self.input_stepsize_y());
            }
            console.log("//loopGrid")
        }

        self.probe = function() {
            console.log("##probe")
            self.setAndSendGcode("G38.3 Z-"+5*self.input_lift_z()+" F"+self.input_feedrate_probe(),true);
            console.log("//probe")
        }

        self.moveOnGrid = function(x,y, retries = 100) {
            console.log("##moveOnGrid")
            // move to next position
            if (self.current_x == x && self.current_y == y) {
                console.log("already at position x:"+self.current_x+", y:"+self.current_y)
                return;
            }
            if (self.moveOngoing) {
                if (retries <= 0) {
                    console.log("moveOngoing=true, retries exhausted")
                    return;
                }
                console.log("moveOngoing=true, waiting 200ms and trying again")
                setTimeout(() => self.moveOnGrid(x, y, retries - 1), 200);
                return;
            }
            self.setAndSendGcode("G0 Z"+self.input_lift_z(),true);
            self.setAndSendGcode("G38.3 X"+x+" Y"+y +" F"+self.input_feedrate_probe());
            console.log("//moveOnGrid")
        
            
            // while (self.moveOngoing==true) {
            //     console.log("moveOngoing=true")
            //     // wait for 200ms
            //     var waitTill = new Date(new Date().getTime() + 200);
            //     while(waitTill > new Date()){}
            // }


        }

        self.checkPosition = function() {
            var Output=self.terminal.displayedLines()
            var x_reported = 0;
            var y_reported = 0;
            var z_reported = 0;
            console.log("##check_position")
            for (let index = 1; index < 10; index++) {
                var currentLine = Output[Output.length - index].line;
                var currentLineType = self.getLineType(currentLine);
                switch (currentLineType) {
                    case "counter":
                        var currentCount= parseInt(currentLine.substring(currentLine.indexOf("Counter:") + 8, currentLine.length));
                        if (self.lastCounterRecvd < currentCount) { //if its a position report save the position
                            self.lastCounterRecvd = currentCount;
                            //CONTINUE WITH NEXT ROW ABOVE IN WHILE LOOP
                        } else {
                            console.log("//checkPosition counter has been read before")
                            return;
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
                            console.log("//checkPosition x:"+self.current_x+", y:"+self.current_y+", z:"+self.current_z+"")
                            return;
                        }
                }
                
                
            }
            console.log("//check_position")
        }

        // self.waitForResponse = function() {
        //     var Output=self.terminal.displayedLines()
        //     console.log("##waitForResponse")
        //     var startTime = Date.now(); // save the current time
        //     var maxDurationMs = self.input_wait_time() * 1000; // convert the wait time to milliseconds
        //     //FIX the Output thats being checked never changes!
        //     while ((Output[Output.length - 2].line.indexOf("Recv: X:") == -1) && (Date.now() - startTime < maxDurationMs)) {
        //     // Wait for the output or until 1000 iterations have occurred or until maxDurationMs has passed
        //     }
        //     var x_reported = Output[Output.length - 2].line.substring(8, Output[Output.length - 2].line.indexOf(" Y:"));
        //     var y_reported = Output[Output.length - 2].line.substring(Output[Output.length - 2].line.indexOf(" Y:") + 4, Output[Output.length - 2].line.indexOf(" Z:"));
        //     var z_reported = Output[Output.length - 2].line.substring(Output[Output.length - 2].line.indexOf(" Z:") + 4, Output[Output.length - 2].line.indexOf(" E:"));
        //     return [x_reported,y_reported];
        //     console.log("//waitForResponse")
        // }

        self.getLineType = function(line) {
            var currentLineType = "";
            if (line.indexOf("Recv: ok") !== -1) {currentLineType="ok"}else{
                if (line.indexOf("Send: ") !== -1) {currentLineType="send"}else{
                    if (line.indexOf("Recv: Counter:") !== -1) {currentLineType="counter"} else {
                        if (line.indexOf("Recv: X:") !== -1) {currentLineType="position"}
                    }
                }
            }
            return currentLineType;
        }

        self.suppressTempMsg = function() {
            console.log("##suppressTempMsg")
            self.setAndSendGcode("M155 S60");
            console.log("//suppressTempMsg")
        }

        //gcode as string, relative as boolean
        self.setAndSendGcode = function(gcode,relative = false) {
            if (relative) {
                self.terminal.command("G91");
                self.terminal.sendCommand();
            }
            //if gcode contains moves ("G0", "G38", "G1") then set move ongoing to true
            if (gcode.indexOf("G0") != -1 || gcode.indexOf("G38") != -1 || gcode.indexOf("G1") != -1) {
                self.move_ongoing = true;
                self.SendCounter();
            }
            console.log("##setAndSendGcode: "+gcode)
            self.terminal.command(gcode);
            self.terminal.sendCommand();

            if (relative) {
                self.terminal.command("G90");
                self.terminal.sendCommand();
            }

            if (gcode.indexOf("G0") != -1 || gcode.indexOf("G38") != -1 || gcode.indexOf("G1") != -1 || gcode.indexOf("G92") != -1) {
                self.askForPosition();
            }
            console.log("//setAndSendGcode")

        }
        
        self.askForPosition = function() {
            self.SendCounter();
            self.terminal.command("M114")
            self.terminal.sendCommand()
        }

        self.SendCounter = function() {
            self.terminal.command("M118 Counter:"+self.counter);
            self.terminal.sendCommand()
            self.counter=self.counter+1;
        }
        
        // self.waitForCondition =function() {
        //     console.log("##waitForCondition")
        //     var Output = self.terminal.displayedLines()
        //     // Check the condition
        //     alert("Check if it matches:"+ Output[Output.length-1].line)
        //         console.log(Output[Output.length-1].line)
        //     if (Output[Output.length-1].line == "Recv: wait") {
        //         // Call the callback function
        //         alert("match")
        //     } else {
        //         // Condition is not met, so wait and check again
        //         setTimeout(function() {
        //         self.waitForCondition();
        //         }, 100);
        //     }
        //     console.log("//waitForCondition")
        //     }


        // assign the injected parameters, e.g.:
        // self.loginStateViewModel = parameters[0];
        // self.settingsViewModel = parameters[1];

        // TODO: Implement your plugin's view model here.
    }

    /* view model class, parameters for constructor, container to bind to
     * Please see http://docs.octoprint.org/en/master/plugins/viewmodels.html#registering-custom-viewmodels for more details
     * and a full list of the available options.
     */
    OCTOPRINT_VIEWMODELS.push({
        construct: ZzyycViewModel,
        // ViewModels your plugin depends on, e.g. loginStateViewModel, settingsViewModel, ...
        dependencies: ["loginStateViewModel", "terminalViewModel", "settingsViewModel" ],
        // Elements to bind to, e.g. #settings_plugin_ZZYYC, #tab_plugin_ZZYYC, ...
        elements: [ "#tab_plugin_ZZYYC" /* ... */ ]
    });
});


// G91 ;relative Positioning\n
// G92 X0 Y0 Z10 ;set Zero\n
// ; G0 Z{parameters.travel_z}\n
// ; gcode += f"G38.3 Z-{z_probe_height} F{z_probe_feedrate}\n"
// ; gcode += f"M118 E1 Output:\n"
// ; gcode += "M114\n" # print current coordinates

// ; # Loop through Y coordinates
// ; for y in range(y_start, y_end + 1, y_step):
// ;     # Loop through X coordinates
// ;     for x in range(x_start, x_end + 1, x_step):
// ;         # Move to position with Z travel height
// ;         distance = ((x-center_x)**2 + (y-center_y)**2)**0.5
// ;         # calculate the Z travel height based on the distance
// ;         # z_travel = 30 - (distance * 30/max_distance)
// ;         # z_travel = max(z_travel_height_min, z_travel) # ensure z_travel is at least 1mm

// ;         # if y < 65 or y >110:
// ;         #     z_travel = 5
// ;         # else:
// ;         #     z_travel=10

// ;         gcode += f"G0 Z{z_travel}\n"
// ;         gcode += f"G0 X{x_step}\n"
// ;         # Probe Z axis
// ;         gcode += f"G38.3 Z-{z_probe_height} F{z_probe_feedrate}\n"
// ;         gcode += f"M118 E1 Output:\n"
// ;         gcode += "M114\n" # print current coordinates


// ;     gcode += f";New Line\n"
// ;     gcode += f"G0 Z{z_safety_height}\n"
// ;     gcode += f"G0 Y{y_step}\n"
// ;     gcode += f"G90 ;absolute positioning\n" #absolute positioning 
// ;     gcode += f"G0 X0\n" #go to x zero
// ;     gcode += f"G91 ;relative positioning\n" # relative positioning

// ;     gcode += f"G0 Z-{z_safety_height-5}\n"
// ;     gcode += f"G38.3 Z-{z_probe_height} F{z_probe_feedrate}\n"
// ;     gcode += f"M118 E1 Output:\n"
// ;     gcode += "M114\n" # print current coordinates

// ;     # gcode += f"G38.3 Z-{z_probe_height} F{z_probe_feedrate}\n"
// ;     # gcode += f"M118 E1 Output:\n"
// ;     # gcode += "M114\n" # print current coordinates

// ; # Print final G-code string
// ; print(gcode)