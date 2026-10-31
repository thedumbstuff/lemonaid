// Lemonaid embed: adds the board to the page, right where this script sits.
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;
  var frame = document.createElement('iframe');
  frame.src = origin + '/board/';
  frame.title = 'Lemonaid discussion board';
  frame.style.cssText = 'width:100%;min-height:520px;border:0;display:block;';
  frame.setAttribute('loading', 'lazy');
  script.parentNode.insertBefore(frame, script);
})();
