const puppeteer = require("puppeteer");
const merge = require("lodash.merge");
const debug = require("./debug");
const { getMergedOptions } = require("./options");
const fs = require('fs');

// starts a server and returns it
// - server runs on random open port
//   callers can use server.address().port to read the port
// - server serves "html" as index.html
// - server serves static files in all public paths
const createServer = async (html, { serve }) => {
  const http = require("http");
  const connect = require("connect");
  const serveStatic = require("serve-static");
  const finalhandler = require("finalhandler");

  const app = connect();
  app.use(
    (request, response, next) => {
      var done = finalhandler(request, response);
      if (request.url === "/") {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(html);
        console.log('server response to request with HTML');       
      }
      done();
    }
  );

  // serve all public paths
  serve.forEach(servedFolder => app.use(serveStatic(servedFolder)));

 // app.use(finalhandler); // this is problematic cause "Timeout - Async callback was not invoked within the 30000 ms timeout specified by jest.setTimeout.Timeout - Async callback was not invoked within the 30000 ms timeout specified by jest.setTimeout.Error: "
  const server = http.createServer(app);

  // Start server on a random unused port.
  //
  // We can't use a predeterimined port as Jest runs tests in parrallel, so
  // multiple tests would attempt to use the same port.
  //
  // Inspired by https://gist.github.com/mikeal/1840641
  await new Promise((resolve, reject) => {
    const startServer = () => {
      // 0 assigns a random port, but it does not guarantee that it is unsed
      // We still need to handle that case
      server.once("error", e => {
        if (e.code === "EADDRINUSE") {
          console.error('EADDRINUSE, closing server, retrying', e);
          server.close(startServer);
        }
      });
      // 0 assigns a random port.
      // The port may be used, so we have to retry to find an unused port
      console.log('server listen start');
      server.listen(0, (err) => {
        console.log('server listen returned with err', err);
        return (err ? reject(err) : resolve());
      });
    };
    startServer();
  });
  
  return server;
};

// return image or null
const takeScreenshot = async (url, opts) => {
  // opts.screenshot may contain options which should get forwarded to
  // puppeteer's page.screenshot as they are
  const screenshotOptions = merge({}, opts.screenshot);

  try {

    // Options see:
    // https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#puppeteerlaunchoptions
    const browser = await puppeteer.launch(opts.launch);
    console.log('puppeteer launch');
    const page = await browser.newPage();
    console.log('puppeteer newPage');

    if (typeof opts.intercept === "function") {
      await page.setRequestInterception(true);
      page.on("request", opts.intercept);
    }
    //console.log('going to url', url, opts.waitUntilNetworkIdle);
    await page.goto(
      url,
      opts.waitUntilNetworkIdle ? { waitUntil: "networkidle0" } : {}
    );
    //console.log('after page.goto', url);

    // If user provided options.targetSelector we try to find that element and
    // use its bounding box to clip the screenshot.
    // When no element is found we fall back to opts.screenshot.clip in case it
    // was specified already
    if (opts.targetSelector) {
      screenshotOptions.clip = await page.evaluate(
        (targetSelector, fallbackClip) => {
          const target = document.querySelector(targetSelector);
          return target
            ? {
                x: target.offsetLeft,
                y: target.offsetTop,
                width: target.offsetWidth,
                height: target.offsetHeight
              }
            : // fall back to manual clipping values in case the element could
              // not be found
              fallbackClip;
        },
        opts.targetSelector,
        screenshotOptions.clip
      );
    }
console.log('going to take screenshot');
    const image = await page.screenshot(screenshotOptions);
    console.log("after getting screenshot");
    browser.close();
    console.log("after browser close");
    return image; // NEW
  } catch (e) {
    console.error('ERROR: exception during takeScreenshot', e);
  }

  return NULL;
};

const generateImage = async options => {
  const opts = getMergedOptions(options);

  // Allows easy debugging by passing generateImage({ debug: true })
  if (opts.debug) debug(document);

  // get HTML from JSDOM
  const html = document.documentElement.outerHTML;

  // We start a server to enable serving local assets.
  // The adds only ~0.05s so it's not worth skipping it.
  // Using a server further enables intercepting requests with relative urls,
  // which would not be possible when using page.goto(`data:text/html,${html}`).catch
  //
  // Another approach would be to use page.setContent(html) and to not start a
  // node server at all.
  //
  // But then we can't wait for files to be loaded
  // https://github.com/GoogleChrome/puppeteer/issues/728#issuecomment-334301491
  //
  // And we would not be able to serve local assets (the ones included through
  // tags like <img src="/party-parrot.gif" />). We run the node server instead
  // to serve the generated html and to serve local assets.
  console.log('html', html.substr(0, 100));
  fs.writeFileSync('c:/dev/decoders.html', html, { encoding: 'utf8'} );
  console.log('after file write sync');
  const server = await createServer(html, opts);
  const url = `http://localhost:${server.address().port}`;
  const screenshot = await takeScreenshot(url, opts);
  console.log('after await takeScreenshot');
  await new Promise((resolve) => { 
    console.log('closing server', server);
    server.close(resolve);
  });
  return screenshot;
};

module.exports = generateImage;
