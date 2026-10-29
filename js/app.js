// Milestone 0: confirm that CSS and JavaScript load correctly on GitHub Pages.
const cssCheck = document.getElementById("check-css");
const jsCheck = document.getElementById("check-js");

jsCheck.classList.add("ok");

// If style.css loaded, the custom property below is defined.
const cssLoaded = getComputedStyle(document.documentElement)
  .getPropertyValue("--ok").trim() !== "";
if (cssLoaded) cssCheck.classList.add("ok");
