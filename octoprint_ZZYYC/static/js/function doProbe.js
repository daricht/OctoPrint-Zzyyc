function doProbe() {
    console.log("##doProbe")
    self.setAndSendGcode(`G38.3 Z-${5 * parseInt(self.input_lift_z())} F${parseInt(self.input_feedrate_probe()) + parseInt(self.counter)}`);
    self.counter++;
    return new Promise(resolve => {
        function checkProbeResult() {

            const output = self.terminal.displayedLines();
            for (let i = output.length - 1; i >= 0; i--) {
                const line = output[i].line;
                if (line.includes("Send: G38.3 Z")) {
                    if (line.includes("F")) {
                        counterrcvd=parseFloat(line.match(/F(\d+)/)[1]) - parseFloat(self.input_feedrate_probe())
                        if (self.lastCounterRecvd == counterrcvd) {
                            setTimeout(checkProbeResult, 100);
                            return;
                        } else { // if the counter is different, the probe will wait and try again
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

                if (line.includes("Recv: X:") || line.includes("Recv: ok X:")) {
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