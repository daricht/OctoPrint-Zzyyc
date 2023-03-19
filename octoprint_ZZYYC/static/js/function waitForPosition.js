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
                                    return;
                                } else {
                                    self.lastCounterRecvd = parseFloat(line.match(/F(\d+)/)[1]) - parseFloat(self.input_feedrate_probe());
                                    setTimeout(checkProbeResult, 100);
                                    return;
                                }
                            }
                        }
                        if (self.lastCounterRecvd != self.counter-1) {
                            setTimeout(checkProbeResult, 100);
                            return;
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