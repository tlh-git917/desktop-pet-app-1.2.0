(() => {
  let audioContext = null;

  const SOUND_MAP = {
    purchase: [
      { frequency: 659.25, duration: 0.08, type: 'triangle', volume: 0.06 },
      { frequency: 783.99, duration: 0.08, type: 'triangle', volume: 0.07 },
      { frequency: 987.77, duration: 0.14, type: 'sine', volume: 0.08 }
    ],
    apply: [
      { frequency: 523.25, duration: 0.08, type: 'triangle', volume: 0.05 },
      { frequency: 659.25, duration: 0.11, type: 'sine', volume: 0.06 }
    ],
    'task-done': [
      { frequency: 523.25, duration: 0.07, type: 'triangle', volume: 0.05 },
      { frequency: 659.25, duration: 0.07, type: 'triangle', volume: 0.06 },
      { frequency: 783.99, duration: 0.12, type: 'sine', volume: 0.07 }
    ],
    'focus-complete': [
      { frequency: 392.0, duration: 0.09, type: 'triangle', volume: 0.04 },
      { frequency: 523.25, duration: 0.09, type: 'triangle', volume: 0.05 },
      { frequency: 659.25, duration: 0.1, type: 'triangle', volume: 0.06 },
      { frequency: 783.99, duration: 0.16, type: 'sine', volume: 0.08 }
    ],
    'pet-tap': [
      { frequency: 740.0, duration: 0.05, type: 'triangle', volume: 0.05 }
    ],
    visitor: [
      { frequency: 587.33, duration: 0.08, type: 'triangle', volume: 0.05 },
      { frequency: 659.25, duration: 0.08, type: 'triangle', volume: 0.05 },
      { frequency: 783.99, duration: 0.14, type: 'sine', volume: 0.06 }
    ]
  };

  async function ensureAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) {
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    return audioContext;
  }

  async function playDesktopPetSound(soundId) {
    const context = await ensureAudioContext();
    if (!context) return false;
    const notes = SOUND_MAP[soundId] || SOUND_MAP.apply;
    let cursor = context.currentTime + 0.01;

    notes.forEach((note, index) => {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      oscillator.type = note.type || 'sine';
      oscillator.frequency.setValueAtTime(note.frequency || 440, cursor);

      gainNode.gain.setValueAtTime(0.0001, cursor);
      gainNode.gain.exponentialRampToValueAtTime(note.volume || 0.05, cursor + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, cursor + (note.duration || 0.1));

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.start(cursor);
      oscillator.stop(cursor + (note.duration || 0.1) + 0.03);
      cursor += (note.duration || 0.1) + (index === notes.length - 1 ? 0 : 0.03);
    });

    return true;
  }

  window.playDesktopPetSound = function playDesktopPetSoundSafe(soundId) {
    return playDesktopPetSound(soundId).catch(() => false);
  };
})();
