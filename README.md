![TailorX logo](./logo/tailorx-logo.png)

---

[![NPM](https://nodei.co/npm/tailorx.png)](https://npmjs.org/package/tailorx)
[![Build Status](https://travis-ci.com/StyleT/tailorx.svg?branch=master)](https://travis-ci.com/StyleT/tailorx)
[![Test Coverage](https://codecov.io/github/StyleT/tailorx/coverage.svg?precision=0)](https://codecov.io/github/StyleT/tailorx)
[![OpenTracing Badge](https://img.shields.io/badge/OpenTracing-enabled-blue.svg)](http://opentracing.io)

## npm status

[![downloads](https://img.shields.io/npm/dt/tailorx.svg)](https://npmjs.org/package/tailorx)
[![version](https://img.shields.io/npm/v/tailorx.svg)](https://npmjs.org/package/tailorx)

TailorX is a layout service that uses streams to compose a web page from fragment services.
O'Reilly describes it in the title of
[this blog post](https://www.oreilly.com/ideas/better-streaming-layouts-for-frontend-microservices-with-tailor)
as "a library that provides a middleware which you can integrate into any Node.js server."
It's partially inspired by Facebook’s [BigPipe](https://www.facebook.com/notes/facebook-engineering/bigpipe-pipelining-web-pages-for-high-performance/389414033919/)
and based on [Zalando Tailor](https://github.com/zalando/tailor).

Some of TailorX's features and benefits:

* **Composes pre-rendered markup on the backend**. This is important for SEO and fastens the initial render.
* **Ensures a fast Time to First Byte**. TailorX requests fragments in parallel and streams them as soon as possible, without blocking the rest of the page.
* **Enforces performance budget**. This is quite challenging otherwise, because there is no single point where you can control performance.
* **Fault Tolerance**. Render the meaningful output, even if a page fragment has failed or timed out.

TailorX is part of [Isomorphic Layout Composer Project](https://github.com/StyleT/icl), which aims to help developers create microservices for the frontend. If your front-end team is making the monolith-to-microservices transition, you might find TailorX and its available siblings beneficial.

## Why a Layout Service?

Microservices get a lot of traction these days. They allow multiple teams to work independently from each other, choose their own technology stacks and establish their own release cycles. Unfortunately, frontend development hasn’t fully capitalized yet on the benefits that microservices offer. The common practice for building websites remains “the monolith”: a single frontend codebase that consumes multiple APIs.

What if we could have microservices on the frontend? This would allow frontend developers to work together with their backend counterparts on the same feature and independently deploy parts of the website — “fragments” such as Header, Product, and Footer. Bringing microservices to the frontend requires a layout service that composes a website out of fragments. Tailor was developed to solve this need.

## Installation

Begin using TailorX with:

```sh
npm i tailorx
```

```javascript
const http = require('http');
const Tailor = require('tailorx');
const tailor = new Tailor({/* Options */});
const server = http.createServer(tailor.requestHandler);
server.listen(process.env.PORT || 8080);
```

## Options

* `fetchContext(request)` - Function that returns a promise of the context, that is an object that maps fragment id to fragment url, to be able to override urls of the fragments on the page, defaults to `Promise.resolve({})`
* `fetchTemplate(request, parseTemplate)` - Function that should fetch the template, call `parseTemplate` and return a promise of the result. Useful to implement your own way to retrieve and cache the templates, e.g. from s3.
Default implementation [`lib/fetch-template.js`](./lib/fetch-template.js) fetches the template from  the file system
* `templatesPath` - To specify the path where the templates are stored locally, Defaults to `/templates/`
* `fragmentTag` - Name of the fragment tag, defaults to `fragment`
* `handledTags` - An array of custom tags, check [`tests/handle-tag`](./tests/handle-tag.js) for more info
* `baseTemplatesCacheSize` - It is off by default. This cache can speed up parsing base templates. You need to specify it as a number of your base templates to cache the parsing of your templates but don't specify it bigger than the number of templates that your app has because it can cause memory issues at your server.
* `handleTag(request, tag, options, context)` - Receives a tag or closing tag and serializes it to a string or returns a stream
* `filterRequestHeaders(attributes, request)` - Function that filters the request headers that are passed to fragment request, check default implementation in [`lib/filter-headers`](./lib/filter-headers.js)
* `filterResponseHeaders(attributes, headers)` - Function that maps the given response headers from the primary & `return-headers` fragments to the final response
* `maxAssetLinks` - Number of `Link` Header directives for CSS and JS respected per fragment - defaults to `1`
* `requestFragment(filterHeaders)(url, attributes, request)` - Function that returns a promise of request to a fragment server, check the default implementation in [`lib/request-fragment`](./lib/request-fragment.js)
* `tracer` - Opentracing [compliant Tracer implementation](https://doc.esdoc.org/github.com/opentracing/opentracing-javascript/class/src/tracer.js~Tracer.html).
* `botsGuardEnabled` - `false` by default. This option forces TailorX to respond with 500 error code even if non-primary fragment fails in case the request comes from SEO/SM bot.
Bot detection is done via [device-detector-js](https://www.npmjs.com/package/device-detector-js).
* `fragmentHooks` - Allows to override default behaviour of the `insertStart` & `insertEnd` hooks & wrap response from the fragment with custom code.
    * `insertStart(stream, attributes, headers, index)`
    * `insertEnd(stream, attributes, headers, index)`
* `getAssetsToPreload()` - If specified, should return array of assets that should be added to the response `Link` header for preload.
Return value format: `{styleRefs: ['https://ex.com/style.css'], scriptRefs: ['https://ex.com/script.css']}`

## Template

TailorX uses [parse5](https://github.com/inikulin/parse5/) to parse the template, where it replaces each `fragmentTag` with a stream from the fragment server and `handledTags` with the result of `handleTag` function.

```html
<html>
<head>
    <script type="fragment" src="http://assets.domain.com"></script>
</head>
<body>
    <fragment src="http://header.domain.com"></fragment>
    <fragment src="http://content.domain.com" primary></fragment>
    <fragment src="http://footer.domain.com" async></fragment>
</body>
</html>
```

### Fragment attributes

* `id` - optional unique identifier (autogenerated)
* `src` - URL of the fragment
* `primary` - denotes a fragment that sets the response code of the page
* `timeout` - optional timeout of fragment in milliseconds (default is 3000)
* `async` - postpones the fragment until the end of body tag
* `public` - to prevent TailorX from forwarding filtered request headers from upstream to the fragments.
* `return-headers` - makes TailorX to wait for the fragment response headers & send them in response.
Note that they will be merged with headers from `primary` fragment & may be overwritten by it.
* `forward-querystring` - forwards query parameters from the original request down to the fragment

> Other attributes are allowed and will be passed as well to relevant functions (eg. `filterRequestHeaders`, `filterResponseHeaders`, etc.)

### Fragment server

A fragment is an http(s) server that renders only the part of the page and sets `Link`, `x-head-title`, `x-head-meta`
headers (valid only for primary fragment) to provide urls to CSS and JavaScript resources.

Primary fragment possible response headers:
* `Link` - Check [reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Link).
* `x-head-title` - Page title encoded with base64. Will be injected onto `<head>` tag.
Ex: `Buffer.from('<title>Page title</title>', 'utf-8').toString('base64')`
* `x-head-meta` - Page [meta tags](https://www.w3schools.com/tags/tag_meta.asp) encoded with base64.
Ex: `Buffer.from('<meta name="description" content="Free Web tutorials"><meta name="keywords" content="HTML,CSS,XML,JavaScript">', 'utf-8').toString('base64')`

Check [`examples/basic-css-and-js/index.js`](./examples/basic-css-and-js/index.js) for a draft implementation.

A JavaScript of the fragment is an AMD module, that exports an `init` function, that will be called with DOM element of the fragment as an argument.

TailorX will not follow redirects even if fragment response contains 'Location' Header, that is on purpose as redirects can introduce unwanted latency. Fragments with the attribute `primary` can do a redirect since it controls the status code of the page.

**Note: For compatability with AWS the `Link` header can also be passed as `x-amz-meta-link`**

### Passing information to fragments

By default, the incoming request will be used to selecting the template.

So to get the `index.html` template you go to `/index`.

If you want to listen to `/product/my-product-123` to go to `product.html` template, you can change the `req.url` to `/product`.

Every header is filtered by default to avoid leaking information, but you can give the original URI and host by adding it to the headers, `x-request-host` and `x-request-uri`, then reading in the fragment the headers to know what product to fetch and display.

```javascript
http
    .createServer((req, res) => {
        req.headers['x-request-uri'] = req.url
        req.url = '/index'

        tailor.requestHandler(req, res);
    })
    .listen(8080, function() {
        console.log('Tailor server listening on port 8080');
    });
```

### Concepts

Some of the concepts in TailorX are described in detail on the specific docs.

* [Events](./docs/Events.md)
* [Base Templates](./docs/Base-Templates.md)
* [Hooks](./docs/hooks.md)
* [Performance](./docs/Performance.md)

## OpenTracing

TailorX has out of the box distributed tracing instrumentation with [OpenTracing](https://opentracing.io).
It will pick up any span context on the ingress HTTP request and propagate it to the existing
Remote Procedure Calls (RPCs).

Currently, only the fetching of fragments is instrumented providing some additional details like the
fragment tag, attributes and some logging payload like the stack trace for errors.

## Examples

* Basic - `node examples/basic`
* CSS and JS - `node examples/basic-css-and-js`
* Multiple Fragments and AMD - `node examples/multiple-fragments-with-custom-amd`
* Fragment Performance - `node examples/fragment-performance`

Go to [http://localhost:8080/index](http://localhost:8080/index) after running the specific example.

**Note: Please run the examples with node versions > 12.0.0**

## Benchmark

To start running benchmark execute `npm run benchmark` and wait for couple of seconds to see the results.

## Contributing

Please check the Contributing guidelines [here](./CONTRIBUTING.md).
