// Lemonaid embed: adds the board to the page, right where this script sits.
//   <script src="https://your-board/lemonaid.js"></script>
// Optional: data-color="#0a7e5a" sets the board's main colour to match your site.
(function () {
  var script = document.currentScript;
  if (!script) return;
  var origin = new URL(script.src).origin;
  var color = (script.getAttribute('data-color') || '').replace('#', '');
  var frame = document.createElement('iframe');
  frame.src = origin + '/board/' + (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? '?color=' + color : '');
  frame.title = 'Lemonaid discussion board';
  frame.style.cssText = 'width:100%;min-height:520px;border:0;display:block;';
  frame.setAttribute('loading', 'lazy');
  script.parentNode.insertBefore(frame, script);

  // The board tells us how tall it is, so there is no scroll bar inside the frame.
  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow || e.origin !== origin) return;
    var d = e.data;
    if (d && d.lemonaid === 'height' && typeof d.height === 'number' && d.height > 0 && d.height < 100000) {
      frame.style.height = Math.max(520, Math.ceil(d.height)) + 'px';
    }
  });
})();
