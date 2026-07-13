import { Brain }         from './brain.js';
import { boot, warmup } from './boot.js';
import { Consciousness } from './consciousness.js';
import { getWebUI }      from './web-server';
import { saveSnapshot, loadSnapshot, saveState, loadState } from './snapshot.js';

const brain = new Brain();
brain.start(2000);

let consciousness;

const ui = getWebUI((text) => {
    if (consciousness) consciousness.receive(text);
    else ui.log('Still booting, hold on...');
});

ui.start(3000);

function launch() {
    consciousness = new Consciousness(brain, ui);
    ui.attachBrain(brain);

    process.on('SIGINT', async () => {
        ui.log('Shutting down...');
        consciousness.stop();
        saveSnapshot(brain.engine);
        saveState(consciousness);
        brain.stop();
        process.exit(0);
    });

    // Delay ready so the WS client has time to connect before we send the first message
    setTimeout(() => {
        ui.ready();
        consciousness.start();
    }, 500);
}

ui.log('Neural tissue allocated.');

export default function bootBrain(){
    if (loadSnapshot(brain.engine)) {
        ui.log('Snapshot loaded.');
        warmup(brain).then(() => {
            consciousness = new Consciousness(brain, ui);
            ui.attachBrain(brain);
            const stateLoaded = loadState(consciousness);
            ui.log(stateLoaded ? 'State restored.' : 'No state file, starting fresh.');

            process.on('SIGINT', async () => {
                ui.log('Shutting down...');
                consciousness.stop();
                saveSnapshot(brain.engine);
                saveState(consciousness);
                brain.stop();
                process.exit(0);
            });

            setTimeout(() => {
                ui.ready();
                consciousness.start();
            }, 500);
        });
    } else {
        boot(brain, (msg) => ui.log(msg), (ep, total) => ui.bootProgress(ep, total)).then(() => {
            saveSnapshot(brain.engine);
            launch();
        });
    }
}