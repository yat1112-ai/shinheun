/* Shinheun final pocket-watch focused village test */
(() => {
  function mountFinalClock() {
    const village = document.getElementById("village");
    if (!village) return;

    let scene = document.getElementById("final-clock-scene");
    if (!scene) {
      Array.from(village.children).forEach((el) => {
        el.dataset.clockFinalPrevDisplay = el.style.display || "";
        el.style.display = "none";
      });

      scene = document.createElement("div");
      scene.id = "final-clock-scene";
      scene.innerHTML = `
        <img class="final-hub-bg" src="assets/final-hub-bg.webp" alt="" draggable="false">
        <div class="final-clock-object" role="button" tabindex="0" aria-label="모험 회중시계">
          <div class="final-clock-aura" aria-hidden="true"></div>
          <img class="final-clock-base" src="assets/final-clock-base.webp" alt="" draggable="false">
          <img class="final-clock-rotor" src="assets/final-clock-rotor.webp" alt="" draggable="false">
          <div class="final-clock-core" aria-hidden="true"></div>
        </div>
      `;
      village.appendChild(scene);
    }

    if (!document.getElementById("final-clock-style")) {
      const style = document.createElement("style");
      style.id = "final-clock-style";
      style.textContent = `
        #common-controls, #fullscreen-notice { display:none !important; }
        #final-clock-scene {
          position:absolute; inset:0; z-index:100;
          overflow:hidden; background:#d7efff;
          user-select:none; -webkit-user-select:none;
        }
        #final-clock-scene .final-hub-bg {
          position:absolute; inset:0;
          width:100%; height:100%; object-fit:cover;
          pointer-events:none;
        }
        .final-clock-object {
          position:absolute;
          left:50%;
          bottom:144px;
          width:345px;
          height:431px;
          transform:translateX(-50%);
          transform-origin:50% 100%;
          cursor:pointer;
          outline:none;
          filter:drop-shadow(0 15px 18px rgba(31,61,87,.28));
          animation:final-clock-float 5.4s ease-in-out infinite;
        }
        .final-clock-base, .final-clock-rotor {
          position:absolute; inset:0;
          width:100%; height:100%;
          object-fit:contain;
          pointer-events:none;
        }
        .final-clock-base { z-index:2; }
        .final-clock-rotor {
          z-index:3;
          transform-origin:49.9% 35.7%;
          animation:final-clock-spin 20s linear infinite;
          will-change:transform;
        }
        .final-clock-aura {
          position:absolute; z-index:1;
          left:50%; top:35.7%;
          width:205px; height:205px;
          border-radius:50%;
          transform:translate(-50%,-50%);
          background:radial-gradient(circle,
            rgba(255,255,255,.72) 0 5%,
            rgba(104,215,255,.34) 21%,
            rgba(62,118,255,.16) 45%,
            rgba(255,207,91,.10) 58%,
            transparent 73%);
          filter:blur(8px);
          animation:final-clock-aura 2.8s ease-in-out infinite;
        }
        .final-clock-core {
          position:absolute; z-index:4;
          left:49.9%; top:35.7%;
          width:54px; height:54px;
          border-radius:50%;
          transform:translate(-50%,-50%);
          background:radial-gradient(circle,
            rgba(255,255,255,.96) 0 7%,
            rgba(120,231,255,.46) 28%,
            rgba(70,130,255,.18) 55%,
            transparent 73%);
          mix-blend-mode:screen;
          box-shadow:0 0 18px rgba(112,220,255,.64),
                     0 0 40px rgba(75,139,255,.28);
          animation:final-clock-core 2.15s ease-in-out infinite;
          pointer-events:none;
        }
        .final-clock-object:hover,
        .final-clock-object:focus-visible {
          filter:drop-shadow(0 16px 20px rgba(31,61,87,.28))
                 drop-shadow(0 0 13px rgba(110,204,255,.4));
        }
        .final-clock-object:hover .final-clock-rotor,
        .final-clock-object:focus-visible .final-clock-rotor {
          animation-duration:13s;
        }
        @keyframes final-clock-spin {
          from { transform:rotate(0deg); }
          to   { transform:rotate(360deg); }
        }
        @keyframes final-clock-float {
          0%,100% { transform:translateX(-50%) translateY(0); }
          50%     { transform:translateX(-50%) translateY(-2px); }
        }
        @keyframes final-clock-aura {
          0%,100% { opacity:.62; transform:translate(-50%,-50%) scale(.96); }
          50%     { opacity:1; transform:translate(-50%,-50%) scale(1.05); }
        }
        @keyframes final-clock-core {
          0%,100% { opacity:.58; transform:translate(-50%,-50%) scale(.88); }
          50%     { opacity:1; transform:translate(-50%,-50%) scale(1.15); }
        }
        @media (max-width:900px) {
          .final-clock-object {
            bottom:138px;
            width:330px;
            height:413px;
          }
        }
        @media (prefers-reduced-motion:reduce) {
          .final-clock-object,.final-clock-rotor,
          .final-clock-aura,.final-clock-core { animation:none !important; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountFinalClock, {once:true});
  } else {
    mountFinalClock();
  }
})();