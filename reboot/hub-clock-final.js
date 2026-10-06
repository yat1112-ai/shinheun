/* Shinheun final pocket-watch focused village test */
(() => {
  function mountFinalClock() {
    const village = document.getElementById("village");
    if (!village) return;

    document.documentElement.classList.add("final-clock-mode");
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute("content", "#bfe3f7");

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
          <div class="final-clock-contact-shadow" aria-hidden="true"></div>
          <div class="final-clock-aura" aria-hidden="true"></div>
          <img class="final-clock-base" src="assets/final-clock-base.webp" alt="" draggable="false">
          <img class="final-clock-rotor" src="assets/final-clock-rotor.webp" alt="" draggable="false">
          <div class="final-clock-core" aria-hidden="true"></div>
        </div>
      `;
      village.appendChild(scene);

      const clock = scene.querySelector(".final-clock-object");
      const openAdventure = () => {
        if (window.UIPreview && typeof window.UIPreview.setScene === "function") {
          window.UIPreview.setScene("battle");
        }
      };
      clock.addEventListener("click", openAdventure);
      clock.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openAdventure();
        }
      });
    }

    if (!document.getElementById("final-clock-style")) {
      const style = document.createElement("style");
      style.id = "final-clock-style";
      style.textContent = `
        html.final-clock-mode,
        html.final-clock-mode body {
          background:#bfe3f7 !important;
          color-scheme:only light;
          forced-color-adjust:none;
        }
        html.final-clock-mode #viewport {
          background:#dff2ff !important;
        }
        html.final-clock-mode #stage {
          background:#dff2ff !important;
          box-shadow:none !important;
        }

        #common-controls,
        #fullscreen-notice { display:none !important; }

        #final-clock-scene {
          position:absolute;
          inset:0;
          z-index:100;
          overflow:hidden;
          background:#eef9ff;
          color-scheme:only light;
          isolation:isolate;
          user-select:none;
          -webkit-user-select:none;
        }

        #final-clock-scene .final-hub-bg {
          position:absolute;
          inset:0;
          width:100%;
          height:100%;
          object-fit:cover;
          pointer-events:none;
          opacity:1;
          filter:brightness(1.03) saturate(1.015);
        }

        .final-clock-object {
          position:absolute;
          left:50%;
          bottom:170px;
          width:310px;
          height:387px;
          transform:translateX(-50%);
          transform-origin:50% 100%;
          cursor:pointer;
          outline:none;
          animation:final-clock-float 5.4s ease-in-out infinite;
        }

        .final-clock-contact-shadow {
          position:absolute;
          z-index:0;
          left:50%;
          bottom:2px;
          width:238px;
          height:30px;
          transform:translateX(-50%);
          border-radius:50%;
          background:radial-gradient(ellipse,
            rgba(41,66,75,.30) 0 20%,
            rgba(41,66,75,.15) 44%,
            transparent 72%);
          filter:blur(5px);
          pointer-events:none;
        }

        .final-clock-base,
        .final-clock-rotor {
          position:absolute;
          inset:0;
          width:100%;
          height:100%;
          object-fit:contain;
          pointer-events:none;
          opacity:1;
        }

        .final-clock-base {
          z-index:2;
          filter:drop-shadow(0 9px 8px rgba(31,61,87,.18));
        }

        .final-clock-rotor {
          z-index:3;
          transform-origin:49.91% 35.31%;
          animation:final-clock-spin 22s linear infinite;
          will-change:transform;
        }

        .final-clock-aura {
          position:absolute;
          z-index:1;
          left:49.91%;
          top:35.31%;
          width:184px;
          height:184px;
          border-radius:50%;
          transform:translate(-50%,-50%);
          background:radial-gradient(circle,
            rgba(255,255,255,.70) 0 5%,
            rgba(104,215,255,.32) 21%,
            rgba(62,118,255,.14) 45%,
            rgba(255,207,91,.08) 58%,
            transparent 73%);
          filter:blur(8px);
          animation:final-clock-aura 2.8s ease-in-out infinite;
        }

        .final-clock-core {
          position:absolute;
          z-index:4;
          left:49.91%;
          top:35.31%;
          width:48px;
          height:48px;
          border-radius:50%;
          transform:translate(-50%,-50%);
          background:radial-gradient(circle,
            rgba(255,255,255,.96) 0 7%,
            rgba(120,231,255,.44) 28%,
            rgba(70,130,255,.17) 55%,
            transparent 73%);
          mix-blend-mode:screen;
          box-shadow:
            0 0 16px rgba(112,220,255,.60),
            0 0 34px rgba(75,139,255,.24);
          animation:final-clock-core 2.15s ease-in-out infinite;
          pointer-events:none;
        }

        .final-clock-object:hover .final-clock-base,
        .final-clock-object:focus-visible .final-clock-base {
          filter:
            drop-shadow(0 9px 8px rgba(31,61,87,.18))
            drop-shadow(0 0 11px rgba(110,204,255,.35));
        }

        .final-clock-object:hover .final-clock-rotor,
        .final-clock-object:focus-visible .final-clock-rotor {
          animation-duration:15s;
        }

        @keyframes final-clock-spin {
          from { transform:rotate(0deg); }
          to   { transform:rotate(360deg); }
        }

        @keyframes final-clock-float {
          0%,100% { transform:translateX(-50%) translateY(0); }
          50%     { transform:translateX(-50%) translateY(-3px); }
        }

        @keyframes final-clock-aura {
          0%,100% { opacity:.62; transform:translate(-50%,-50%) scale(.96); }
          50%     { opacity:1; transform:translate(-50%,-50%) scale(1.05); }
        }

        @keyframes final-clock-core {
          0%,100% { opacity:.58; transform:translate(-50%,-50%) scale(.88); }
          50%     { opacity:1; transform:translate(-50%,-50%) scale(1.14); }
        }

        @media (max-width:900px), (max-height:500px) {
          html.final-clock-mode,
          html.final-clock-mode body,
          html.final-clock-mode #viewport,
          html.final-clock-mode #stage,
          #final-clock-scene {
            background:#eefaff !important;
            filter:none !important;
            opacity:1 !important;
          }
          #final-clock-scene .final-hub-bg {
            opacity:1 !important;
            filter:brightness(1.09) saturate(1.035) contrast(.985) !important;
            mix-blend-mode:normal !important;
          }
          .final-clock-object {
            bottom:72px;
            width:250px;
            height:312px;
            filter:drop-shadow(0 9px 10px rgba(31,61,87,.16));
          }
          .final-clock-aura {
            width:150px;
            height:150px;
          }
        }

        @media (prefers-reduced-motion:reduce) {
          .final-clock-object,
          .final-clock-rotor,
          .final-clock-aura,
          .final-clock-core { animation:none !important; }
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