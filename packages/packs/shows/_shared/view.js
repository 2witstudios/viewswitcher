// Shared view helpers: the starter's scene.js, plus a live clock and cut-out grounds.
// ?preview → paint the ground and label device boxes (used by switcher covers).
if (new URLSearchParams(location.search).has("preview")) document.documentElement.classList.add("preview");

// <span data-countdown="5"></span> → counts down 5:00 and loops.
for (const el of document.querySelectorAll("[data-countdown]")) {
  const total = Math.max(1, Number(el.dataset.countdown) || 5) * 60;
  let left = total;
  const draw = () => (el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
  draw();
  setInterval(() => { left = left > 0 ? left - 1 : total; draw(); }, 1000);
}

// <span data-clock></span> → the local time, like 8:42 PM.
for (const el of document.querySelectorAll("[data-clock]")) {
  const draw = () => (el.textContent = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
  draw();
  setInterval(draw, 10000);
}

// A .ground layer (a paper or grid pattern) is masked so every device box shows through it.
function cutOutDevices() {
  const boxes = [...document.querySelectorAll("[data-slot]")].map((el) => el.getBoundingClientRect());
  for (const ground of document.querySelectorAll(".ground")) {
    const g = ground.getBoundingClientRect();
    const layers = ["linear-gradient(#000 0 0)"], position = ["0 0"], size = ["100% 100%"];
    for (const b of boxes) {
      layers.push("linear-gradient(#000 0 0)");
      position.push(`${b.left - g.left}px ${b.top - g.top}px`);
      size.push(`${b.width}px ${b.height}px`);
    }
    Object.assign(ground.style, {
      maskImage: layers.join(", "), maskPosition: position.join(", "), maskSize: size.join(", "),
      maskRepeat: "no-repeat", maskComposite: "exclude",
    });
  }
}
cutOutDevices();

// Transition pages: the switcher posts {viewswitcher: "transition"} as the transition starts.
addEventListener("message", (e) => {
  if (e.data?.viewswitcher !== "transition") return;
  const root = document.documentElement;
  root.classList.remove("play");
  void root.offsetWidth; // restart animations
  root.classList.add("play");
});
