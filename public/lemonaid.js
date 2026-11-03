// Lemonaid embed: adds the board to the page, right where this script sits.
//   <script src="https://your-board/lemonaid.js"></script>
// Optional: data-color="#0a7e5a" sets the board's main colour to match your site.
// Optional: data-height="720" sets how tall the board is, in pixels (default 640). The board
// works like a chat window: the topic list and the discussion scroll inside it.
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;
  var color = (script.getAttribute('data-color') || '').replace('#', '');
  var asked = Number(script.getAttribute('data-height'));
  var height = Number.isInteger(asked) && asked >= 320 && asked <= 2000 ? asked : 640;
  var frame = document.createElement('iframe');
  frame.src = origin + '/board/' + (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? '?color=' + color : '');
  frame.title = 'Lemonaid discussion board';
  // Never taller than the screen, so on a phone the whole chat fits.
  frame.style.cssText = 'width:100%;height:' + height + 'px;max-height:90vh;border:0;display:block;';
  frame.setAttribute('loading', 'lazy');
  script.parentNode.insertBefore(frame, script);
})();
