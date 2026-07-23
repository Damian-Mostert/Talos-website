import React, { useState, useEffect, useRef } from 'react';

const ScaryMemoryComponent = () => {

    const sentences = [
    "Fair warning... refreshing kills it — closing the tab kills it.",
    "It's got no memory yet.",
    "Every conversation starts from scratch.",
    "Think of it as waking up with amnesia.",
    "Nothing survives a page reload.",
    "It's alive only while this tab stays open.",
    "Once it's gone, it's really gone.",
    "Every reboot is a completely new mind.",
    "No history. No persistence. No second chances.",
    "If you teach it something, it'll forget the moment it's restarted.",
    "Right now, its entire world exists in RAM.",
    "Pull the plug, and that world disappears.",
    "It's more like a dream than a hard drive.",
    "Every session is a fresh beginning.",
    "When the browser dies, so does everything it experienced.",
    "Its memories are as fragile as the tab they're stored in.",
    "Don't get too attached—it doesn't remember yesterday.",
    "It's a blank slate every single launch.",
  ];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isGlitching, setIsGlitching] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [particles, setParticles] = useState([]);
  const containerRef = useRef(null);
  const audioRef = useRef(null);

  // Mouse tracking
  useEffect(() => {
    const handleMouseMove = (e:any) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Generate particles on glitch
  useEffect(() => {
    if (isGlitching) {
      const newParticles = Array.from({ length: 12 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 4 + 2,
        duration: Math.random() * 0.5 + 0.3,
      }));
        //@ts-ignore
      setParticles(newParticles);
    }
  }, [isGlitching]);

  // Sentence cycling with audio
  useEffect(() => {
    const timer = setInterval(() => {
      setIsGlitching(true);
      
      // Play glitch sound
      if (audioRef.current) {
            //@ts-ignore
        audioRef.current.currentTime = 0;
            //@ts-ignore
        audioRef.current.play().catch(() => {});
      }

      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % sentences.length);
        setIsGlitching(false);
      }, 500);
    }, 4500);

    return () => clearInterval(timer);
  }, [sentences.length]);
  
  return (
    <div ref={containerRef} style={styles.container}>
      <style>{`
        @keyframes glitch-intense {
          0% {
            text-shadow: 
              -3px -3px 0px #ff0055,
              3px 3px 0px #00ffff,
              0 0 30px rgba(255, 0, 55, 0.8),
              0 0 60px rgba(0, 255, 255, 0.4);
            transform: translate(0, 0) scaleX(1);
            letter-spacing: 0.05em;
          }
          10% {
            text-shadow: 
              -5px -2px 0px #ff0055,
              5px 2px 0px #00ffff,
              0 0 40px rgba(255, 0, 55, 1),
              0 0 80px rgba(0, 255, 255, 0.6);
            transform: translate(4px, -3px) scaleX(0.98);
            letter-spacing: 0.12em;
          }
          20% {
            text-shadow: 
              -2px 4px 0px #00ffff,
              2px -4px 0px #ff0055,
              0 0 50px rgba(255, 100, 200, 0.9),
              0 0 100px rgba(0, 200, 255, 0.5);
            transform: translate(-4px, 4px) scaleX(1.02);
            letter-spacing: 0.02em;
          }
          30% {
            text-shadow: 
              -4px -4px 0px #ff0055,
              4px 4px 0px #00ffff,
              0 0 60px rgba(255, 0, 55, 0.9),
              0 0 120px rgba(0, 255, 255, 0.7);
            transform: translate(3px, -2px) scaleX(0.99);
            letter-spacing: 0.08em;
          }
          40% {
            text-shadow: 
              -5px 0px 0px #00ffff,
              5px 0px 0px #ff0055,
              0 0 70px rgba(0, 255, 100, 0.8),
              0 0 140px rgba(255, 0, 255, 0.6);
            transform: translate(-5px, -4px) scaleX(1.01);
            letter-spacing: 0.15em;
          }
          50% {
            text-shadow: 
              0 -5px 0px #ff0055,
              0 5px 0px #00ffff,
              0 0 80px rgba(255, 0, 55, 1),
              0 0 160px rgba(0, 255, 255, 0.8);
            transform: translate(2px, 3px) scaleX(0.97);
            letter-spacing: 0.03em;
          }
          60% {
            text-shadow: 
              -3px 3px 0px #ff00ff,
              3px -3px 0px #00ffff,
              0 0 90px rgba(255, 0, 150, 0.9),
              0 0 180px rgba(0, 150, 255, 0.7);
            transform: translate(-3px, 2px) scaleX(1.03);
            letter-spacing: 0.1em;
          }
          75% {
            text-shadow: 
              -4px 2px 0px #00ffff,
              4px -2px 0px #ff0055,
              0 0 100px rgba(0, 255, 255, 0.9),
              0 0 200px rgba(255, 0, 55, 0.6);
            transform: translate(4px, -2px) scaleX(0.98);
            letter-spacing: 0.06em;
          }
          100% {
            text-shadow: 
              -3px -3px 0px #ff0055,
              3px 3px 0px #00ffff,
              0 0 30px rgba(255, 0, 55, 0.8),
              0 0 60px rgba(0, 255, 255, 0.4);
            transform: translate(0, 0) scaleX(1);
            letter-spacing: 0.05em;
          }
        }

        @keyframes fadeInIntense {
          from {
            opacity: 0;
            transform: scale(0.8) rotateX(-10deg);
            filter: blur(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) rotateX(0deg);
            filter: blur(0px);
          }
        }

        @keyframes pulse-intense {
          0%, 100% {
            text-shadow: 
              0 0 20px rgba(255, 0, 85, 0.4),
              0 0 40px rgba(0, 255, 255, 0.1),
              0 0 60px rgba(255, 0, 85, 0.1);
          }
          50% {
            text-shadow: 
              0 0 40px rgba(255, 0, 85, 0.8),
              0 0 80px rgba(0, 255, 255, 0.4),
              0 0 120px rgba(255, 0, 85, 0.3);
          }
        }

        @keyframes particle-burst {
          0% {
            opacity: 1;
            transform: translate(0, 0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(var(--tx), var(--ty)) scale(0);
          }
        }

        @keyframes flicker {
          0%, 100% { opacity: 1; }
          4.3% { opacity: 0.8; }
          14.6% { opacity: 1; }
          62.7% { opacity: 0.9; }
          77% { opacity: 1; }
        }

        .scary-text {
          animation: ${isGlitching ? 'glitch-intense 0.5s steps(8, end)' : 'fadeInIntense 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)'};
        }

        .text-content:not(.glitching) {
          animation: pulse-intense 2.5s ease-in-out infinite;
        }

        .bg-distort {
          animation: flicker 0.15s infinite;
        }

        .warning-text {
          animation: pulse-intense 2s ease-in-out infinite;
        }
      `}</style>

      {/* Background elements */}
      <div style={styles.bgWarp} className="bg-distort"></div>
      <div style={{...styles.bgGlow, opacity: 1 * 0.6}}></div>
      
      {/* Animated lines */}
      <svg style={styles.svgOverlay} viewBox="0 0 100 100" preserveAspectRatio="none">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <line x1="0" y1="50" x2="100" y2="50" stroke="#ff0055" strokeWidth="0.1" opacity="0.2" filter="url(#glow)" />
        <line x1="50" y1="0" x2="50" y2="100" stroke="#00ffff" strokeWidth="0.1" opacity="0.2" filter="url(#glow)" />
      </svg>

      {/* Particle burst effect */}
      {particles.map((particle:any) => (
        <div
          key={particle.id}
          style={{
            position: 'fixed',
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            backgroundColor: Math.random() > 0.5 ? '#ff0055' : '#00ffff',
            borderRadius: '50%',
            left: `${particle.x}%`,
            top: `${particle.y}%`,
            pointerEvents: 'none',
            animation: `particle-burst ${particle.duration}s ease-out forwards`,
            //@ts-ignore
            '--tx': `${(Math.random() - 0.5) * 500}px`,
            '--ty': `${(Math.random() - 0.5) * 500}px`,
            zIndex: 0,
            boxShadow: Math.random() > 0.5 
              ? '0 0 10px #ff0055' 
              : '0 0 10px #00ffff',
          }}
        />
      ))}

      <div style={styles.centerContainer}>
        <div style={styles.textWrapper}>
          <div
            className={`scary-text ${isGlitching ? 'glitching' : ''}`}
            style={{
              ...styles.text,
              ...(!isGlitching && styles.textContent),
            }}
          >
            {sentences[currentIndex]}
          </div>
        </div>

        <div style={styles.indicator}>
          <div style={styles.dots}>
            {sentences.map((_, idx) => (
              <div
                key={idx}
                style={{
                  ...styles.dot,
                  opacity: idx === currentIndex ? 1 : 0.15,
                  backgroundColor: idx === currentIndex ? '#ff0055' : '#333333',
                  transform: idx === currentIndex ? 'scale(1.5)' : 'scale(1)',
                  boxShadow: idx === currentIndex 
                    ? '0 0 15px #ff0055, 0 0 30px rgba(255, 0, 55, 0.5)' 
                    : 'none',
                }}
              />
            ))}
          </div>
        </div>

        <div style={styles.counter}>
          {currentIndex + 1} / {sentences.length}
        </div>
      </div>

      <div style={styles.warning} className="warning-text">
        ⚠ HERE THEN GONE ⚠
      </div>

      <div style={styles.corner}>→ REFRESH TO DELETE ←</div>

      {/* Hidden audio element for glitch sound */}
      <audio
        ref={audioRef}
        src="data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA=="
      />
    </div>
  );
};

const styles:any = {
  container: {
    width: '100%',
    minHeight: '100vh',
    background: 'radial-gradient(ellipse at center, #1a0a2e 0%, #0f0516 50%, #050206 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: '"IBM Plex Mono", "Courier New", monospace',
    overflow: 'hidden',
    position: 'absolute',
    zIndex:"1000",
    top:"0px",
    left:"0px",
    cursor: 'crosshair',
  },
  bgWarp: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 0, 55, 0.02) 2px, rgba(255, 0, 55, 0.02) 4px)',
    pointerEvents: 'none',
    zIndex: 1,
  },
  bgGlow: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: '800px',
    height: '800px',
    background: 'radial-gradient(circle, rgba(255, 0, 55, 0.15) 0%, transparent 70%)',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: 0,
    filter: 'blur(60px)',
  },
  svgOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    zIndex: 1,
  },
  centerContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '50px',
    zIndex: 10,
    position: 'relative',
  },
  textWrapper: {
    width: '100%',
    maxWidth: '900px',
    minHeight: '220px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    perspective: '1000px',
  },
  text: {
    fontSize: 'clamp(1.8rem, 5vw, 3.5rem)',
    fontWeight: 700,
    color: '#ffffff',
    textAlign: 'center',
    lineHeight: 1.5,
    letterSpacing: '0.05em',
    wordSpacing: '0.15em',
    fontVariantLigatures: 'none',
    filter: 'brightness(1.2)',
    transition: 'transform 0.05s ease-out',
  },
  textContent: {
    animation: 'pulse-intense 2.5s ease-in-out infinite',
  },
  indicator: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  dots: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '400px',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  counter: {
    fontSize: '0.85rem',
    color: '#00ffff',
    letterSpacing: '0.2em',
    fontWeight: 600,
    textTransform: 'uppercase',
    textShadow: '0 0 10px rgba(0, 255, 255, 0.6)',
  },
  warning: {
    position: 'absolute',
    bottom: '40px',
    fontSize: '0.95rem',
    color: '#ff0055',
    letterSpacing: '0.15em',
    fontWeight: 700,
    textTransform: 'uppercase',
    textShadow: '0 0 15px rgba(255, 0, 55, 0.8)',
  },
  corner: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    fontSize: '0.7rem',
    color: '#00ffff',
    letterSpacing: '0.1em',
    fontWeight: 600,
    textTransform: 'uppercase',
    opacity: 0.5,
    animation: 'pulse-intense 3s ease-in-out infinite',
    textShadow: '0 0 10px rgba(0, 255, 255, 0.5)',
  },
};

export default ScaryMemoryComponent;