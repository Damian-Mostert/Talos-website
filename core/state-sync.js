export function buildStatePayload(mood, neural = {}) {
  const needs = {
    hunger: 0.5,
    energy: 0.5,
    joy: 0.5,
    ...((neural && neural.needs) || {})
  };

  const safeNeural = {
    valence: 0,
    arousal: 0,
    drive: 0,
    norepinephrine: 0,
    needs,
    ...(neural || {})
  };
  safeNeural.needs = {
    hunger: needs.hunger ?? 0.5,
    energy: needs.energy ?? 0.5,
    joy: needs.joy ?? 0.5,
  };

  return {
    type: 'state',
    mood: mood || 'calm',
    neural: safeNeural,
    needs: safeNeural.needs,
    body: safeNeural.body || null,
    regions: safeNeural.regions || null
  };
}

export function buildWorldVisionPayload(scene = {}) {
  const pet = scene.pet || { x: 0.5, y: 0.5 };
  const interaction = scene.interaction || null;
  const mood = scene.mood || 'calm';
  const neural = scene.neural || {};
  const needs = scene.needs || neural.needs || { hunger: 0.5, energy: 0.5, joy: 0.5 };
  const body = scene.body || { x: 0.5, y: 0.48, vx: 0, vy: 0, speed: 0 };
  const opticFlow = scene.opticFlow || { x: -(body.vx || 0), y: -(body.vy || 0), magnitude: body.speed || 0 };
  const motorHint = scene.motorHint || null;

  const detections = [
    {
      label: 'surroundings',
      x: 0.0,
      y: 0.0,
      w: 1.0,
      h: 1.0,
      note: `world context; mood=${mood}`
    },
    {
      label: 'pet-body',
      x: Math.max(0, Math.min(1, pet.x - 0.08)),
      y: Math.max(0, Math.min(1, pet.y - 0.10)),
      w: 0.16,
      h: 0.20,
      note: `pet at ${pet.x.toFixed(2)},${pet.y.toFixed(2)}`
    },
    ...(interaction ? [{
      label: 'contact',
      x: Math.max(0, Math.min(1, interaction.x - 0.04)),
      y: Math.max(0, Math.min(1, interaction.y - 0.04)),
      w: 0.08,
      h: 0.08,
      note: interaction.note || 'contact'
    }] : [])
  ];

  return {
    type: 'vision',
    mood,
    neural,
    needs,
    body,
    opticFlow,
    motorHint,
    interaction,
    objects: detections.map(d => d.label),
    detections
  };
}
