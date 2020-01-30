# Events

`Tailor` extends `EventEmitter`, so you can subscribe to events with `tailor.on('eventName', callback)`.

Events may be used for logging and monitoring. Check [perf/benchmark.js](https://github.com/zalando/tailor/blob/master/perf/benchmark.js#L28) for an example of getting metrics from Tailor.

## Top level events

* Client request received: `start(request)`
* Response started (headers flushed and stream connected to output): `response(request, status, headers)`
* Response ended (with the total size of response): `end(request, contentSize)`
* Error: `error(request, error)` in case an error from template (parsing,fetching) and primary error(socket/timeout/50x)
May be invoked with 2 signatures:
    * `error(request, error)`
    * `error(request, error, response)` - if you received event with this signature you must write response, TailorX will do nothing on it's side 
* Context Error: `context:error(request, error)` in case of an error fetching the context

## Fragment events

* Request start: `fragment:start(request, fragment.attributes)`
* Response Start when headers received: `fragment:response(request, fragment.attributes, status, headers)`
* Response End (with response size): `fragment:end(request, fragment.attributes, contentSize)`
* Error: `fragment:error(request, fragment.attributes, error)` in case of socket error, timeout, 50x


**Note:**  `fragment:response`, `fragment:fallback` and `fragment:error` are mutually exclusive. `fragment:end` happens only in case of successful response.
