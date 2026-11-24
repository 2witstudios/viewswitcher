// Shared scene helpers. Every scene includes this file.
// ?preview → paint the ground and label device slots (used by switcher covers).
if (new URLSearchParams(location.search).has("preview")) document.documentElement.classList.add("preview");

// <span data-countdown="5"></span> → counts down 5:00 and loops.
for (const el of document.querySelectorAll("[data-countdown]")) {
  const total = Math.max(1, Number(el.dataset.countdown) || 5) * 60;
  let left = total;
  const draw = () => (el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
  draw();
  setInterval(() => { left = left > 0 ? left - 1 : total; draw(); }, 1000);
}
