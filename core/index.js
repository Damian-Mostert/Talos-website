import { Brain }         from './brain.js';
import { boot, warmup } from './boot.js';
import { Consciousness } from './consciousness.js';
import { getWebUI }      from './web-server';
import { saveSnapshot, loadSnapshot, saveState, loadState } from './snapshot.js';

export default async function bootBrain(){
    const brain = new Brain();
    brain.start(Number(process.env.NEXT_PUBLIC_BRAIN_SPEED ?? 10));

    let consciousness;

    const ui = getWebUI((text) => {
        if (consciousness) consciousness.receive(text);
        else ui.log('Still booting, hold on...');
    });

    ui.start(3000);

    function saveAndStop() {
        if (!consciousness) return;
        consciousness.stop();
        void saveSnapshot(brain.engine);
        void saveState(consciousness);
        brain.stop();
    }

    function launch() {
        consciousness = new Consciousness(brain, ui);
        ui.attachBrain(brain);

        // Delay ready so the WS client has time to connect before we send the first message
        setTimeout(() => {
            ui.ready();
            consciousness.start();
        }, 500);
    }

    ui.log('Neural tissue allocated.');
    if (await loadSnapshot(brain.engine)) {
        ui.log('Snapshot loaded.');
        await warmup(brain);
            consciousness = new Consciousness(brain, ui);
            ui.attachBrain(brain);
            const stateLoaded = await loadState(consciousness);
            ui.log(stateLoaded ? 'State restored.' : 'No state file, starting fresh.');
            setTimeout(() => {
                ui.ready();
                consciousness.start();
            }, 500);
    } else {
        await boot(brain, (msg) => ui.log(msg), (ep, total) => ui.bootProgress(ep, total));
        await saveSnapshot(brain.engine);
        launch();
    }

    // This module runs in the browser (it is imported by a Client Component),
    // so persist on page lifecycle events rather than registering Node's SIGINT.
    globalThis.addEventListener?.('pagehide', saveAndStop, { once: true });
}
