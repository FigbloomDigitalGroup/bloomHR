// Figbloom HR careers page embed (FIG-838). On a company's website:
//
//   <div data-figbloom-careers="your-slug"></div>
//   <script src="https://<this site>/careers-embed.js" async></script>
//
// Each such element gets the company's hosted careers page in a frame that grows to fit it (the page sends its
// height with postMessage). Nothing else is read from or written to the host page.
(function () {
  var script = document.currentScript;
  var site = script && script.src ? new URL(script.src).origin : window.location.origin;
  var frames = [];

  function mount(el) {
    if (el.getAttribute('data-figbloom-mounted')) return;
    var slug = (el.getAttribute('data-figbloom-careers') || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) return;
    el.setAttribute('data-figbloom-mounted', '1');
    var frame = document.createElement('iframe');
    frame.src = site + '/careers/' + slug + '?embed=1';
    frame.title = 'Careers';
    frame.style.width = '100%';
    frame.style.border = '0';
    frame.style.minHeight = '600px';
    frame.setAttribute('loading', 'lazy');
    el.appendChild(frame);
    frames.push(frame);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== site || !e.data || e.data.type !== 'figbloom-careers:height') return;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) frames[i].style.height = Math.max(200, Number(e.data.height) || 0) + 'px';
    }
  });

  function mountAll() {
    var els = document.querySelectorAll('[data-figbloom-careers]');
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
  else mountAll();
})();
