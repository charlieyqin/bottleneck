var makeTest = require('./context')
var Bottleneck = require('../lib/index.js')
var assert = require('assert')

describe('General', function () {
  var c

  afterEach(function () {
    if (c.limiter.datastore === 'redis') {
      var client = c.limiter.redisClient()
      client.end(false)
    }
  })

  it('Should prompt to upgrade', function () {
    c = makeTest()
    try {
      var limiter = new Bottleneck(1, 250)
    } catch (err) {
      c.mustEqual(err.message, 'Bottleneck v2 takes a single object argument. Refer to https://github.com/SGrondin/bottleneck#upgrading-from-v1 if you\'re upgrading from Bottleneck v1.')
    }
  })

  it('Should check() and return the queued count with and without a priority value', function () {
    c = makeTest({maxConcurrent: 1, minTime: 100})

    return c.limiter.ready()
    .then(function () { return c.limiter.check() })
    .then(function (willRunNow) {
      c.mustEqual(willRunNow, true)

      c.mustEqual(c.limiter.queued(), 0)
      return c.limiter.submit({id: 1}, c.slowJob, 50, null, 1, c.noErrVal(1))
    })
    .then(function () {
      c.mustEqual(c.limiter.queued(), 0) // It's already running
      return c.limiter.check()
    })
    .then(function (willRunNow) {
      c.mustEqual(willRunNow, false)

      return c.limiter.submit({id: 2}, c.slowJob, 50, null, 2, c.noErrVal(2))
    })
    .then(function () {
      c.mustEqual(c.limiter.queued(), 1)
      c.mustEqual(c.limiter.queued(1), 0)
      c.mustEqual(c.limiter.queued(5), 1)

      return c.limiter.submit({id: 3}, c.slowJob, 50, null, 3, c.noErrVal(3))
    })
    .then(function () {
      c.mustEqual(c.limiter.queued(), 2)
      c.mustEqual(c.limiter.queued(1), 0)
      c.mustEqual(c.limiter.queued(5), 2)

      return c.limiter.submit({id: 4}, c.slowJob, 50, null, 4, c.noErrVal(4))
    })
    .then(function () {
      c.mustEqual(c.limiter.queued(), 3)
      c.mustEqual(c.limiter.queued(1), 0)
      c.mustEqual(c.limiter.queued(5), 3)

      return c.limiter.submit({priority: 1, id: 5}, c.job, null, 5, c.noErrVal(5))
    })
    .then(function () {
      c.mustEqual(c.limiter.queued(), 4)
      c.mustEqual(c.limiter.queued(1), 1)
      c.mustEqual(c.limiter.queued(5), 3)

      return c.last()
    })
    .then(function (results) {
      c.mustEqual(c.limiter.queued(), 0)
      c.checkResultsOrder([[1], [5], [2], [3], [4]])
      c.checkDuration(450)
    })

  })

  it('Should return the running count', function () {
    c = makeTest({maxConcurrent: 5, minTime: 0})

    return c.limiter.ready()
    .then(c.limiter.running)
    .then(function (running) {
      c.mustEqual(running, 0)
      c.pNoErrVal(c.limiter.schedule({ weight: 1, id: 1 }, c.slowPromise, 100, null, 1), 1)
      c.pNoErrVal(c.limiter.schedule({ weight: 3, id: 2 }, c.slowPromise, 200, null, 2), 2)
      c.pNoErrVal(c.limiter.schedule({ weight: 1, id: 3 }, c.slowPromise, 100, null, 3), 3)

      return c.limiter.schedule({ weight: 0, id: 4 }, c.promise, null)
    })
    .then(function () {
      return c.limiter.running()
    })
    .then(function (running) {
      c.mustEqual(running, 5)
      return c.wait(125)
    })
    .then(c.limiter.running)
    .then(function (running) {
      c.mustEqual(running, 3)
      return c.wait(100)
    })
    .then(c.limiter.running)
    .then(function (running) {
      c.mustEqual(running, 0)
      return c.last()
    })
    .then(function (results) {
      c.checkDuration(200)
      c.checkResultsOrder([[], [1], [3], [2]])
    })
  })

  describe('Events', function () {
    it('Should fire events on empty queue', function () {
      c = makeTest({maxConcurrent: 1, minTime: 100})
      var calledEmpty = 0
      var calledIdle = 0

      return c.limiter.ready()
      .then(function () {
        c.limiter.on('empty', function () { calledEmpty++ })
        c.limiter.on('idle', function () { calledIdle++ })

        return c.pNoErrVal(c.limiter.schedule({id: 1}, c.slowPromise, 50, null, 1), 1)
      })
      .then(function () {
        c.mustEqual(calledEmpty, 1)
        c.mustEqual(calledIdle, 1)
        return Promise.all([
          c.pNoErrVal(c.limiter.schedule({id: 2}, c.slowPromise, 50, null, 2), 2),
          c.pNoErrVal(c.limiter.schedule({id: 3}, c.slowPromise, 50, null, 3), 3)
        ])
      })
      .then(function () {
        return c.limiter.submit({id: 4}, c.slowJob, 50, null, 4, null)
      })
      .then(function () {
        c.checkDuration(250)
        c.checkResultsOrder([[1], [2], [3]])
        c.mustEqual(calledEmpty, 3)
        c.mustEqual(calledIdle, 2)
        return c.last()
      })
      .catch(function (err) {
        console.log('ERROR!', err)
      })
    })

    it('Should fire events once', function () {
      c = makeTest({maxConcurrent: 1, minTime: 100})
      var calledEmptyOnce = 0
      var calledIdleOnce = 0
      var calledEmpty = 0
      var calledIdle = 0

      return c.limiter.ready()
      .then(function () {
        c.limiter.once('empty', function () { calledEmptyOnce++ })
        c.limiter.once('idle', function () { calledIdleOnce++ })
        c.limiter.on('empty', function () { calledEmpty++ })
        c.limiter.on('idle', function () { calledIdle++ })

        c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 1), 1)
        return c.pNoErrVal(c.limiter.schedule(c.promise, null, 2), 2)
      })
      .then(function () {
        c.mustEqual(calledEmptyOnce, 1)
        c.mustEqual(calledIdleOnce, 1)
        c.mustEqual(calledEmpty, 1)
        c.mustEqual(calledIdle, 1)
        return c.pNoErrVal(c.limiter.schedule(c.promise, null, 3), 3)
      })
      .then(function () {
        c.checkDuration(200)
        c.checkResultsOrder([[1], [2], [3]])
        c.mustEqual(calledEmptyOnce, 1)
        c.mustEqual(calledIdleOnce, 1)
        c.mustEqual(calledEmpty, 2)
        c.mustEqual(calledIdle, 2)
      })
    })

    it.skip('Should fire events when calling stopAll() (sync)', function (done) {
      c = makeTest({maxConcurrent: 1, minTime: 250, rejectOnDrop: false})
      var calledEmpty = 0
      var calledIdle = 0
      var calledDropped = 0

      c.limiter.on('empty', function () { calledEmpty++ })
      c.limiter.on('idle', function () { calledIdle++ })
      c.limiter.on('dropped', function () { calledDropped++ })

      c.pNoErrVal(c.limiter.schedule(c.promise, null, 1), 1)
      c.pNoErrVal(c.limiter.schedule(c.promise, null, 2), 2)
      c.pNoErrVal(c.limiter.schedule(c.promise, null, 3), 3)

      c.limiter.stopAll()
      setTimeout(function () {
        c.mustEqual(calledEmpty, 2)
        c.mustEqual(calledDropped, 2)
        c.mustEqual(calledIdle, 0)
        done()
      }, 30)
    })

    it.skip('Should fire events when calling stopAll() (async)', function (done) {
      c = makeTest({maxConcurrent: 1, minTime: 250, rejectOnDrop: false})
      var calledEmpty = 0
      var calledDropped = 0
      var failedPromise = 0
      var failedCb = 0

      c.limiter.on('empty', function () { calledEmpty++ })
      c.limiter.on('dropped', function (dropped) {
        c.mustEqual(dropped.args.length, 2)
        calledDropped++
      })

      c.pNoErrVal(c.limiter.schedule(c.promise, null, 1), 1)
      c.pNoErrVal(c.limiter.schedule(c.promise, null, 2), 2)
      c.pNoErrVal(c.limiter.schedule(c.promise, null, 3), 3)

      setTimeout(function () {
        c.limiter.stopAll(true)

        c.limiter.schedule(c.promise, null, 4)
        .then(() => assert(false))
        .catch(function (err) {
          c.mustEqual(err.message, 'This limiter is stopped')
          failedPromise++
        })

        c.limiter.submit(c.job, null, 5, function (err) {
          c.mustEqual(err.message, 'This limiter is stopped')
          failedCb++
        })
      }, 0)

      setTimeout(function () {
        c.mustEqual(calledEmpty, 2)
        assert(calledDropped === 2 || calledDropped === 3)
        c.mustEqual(failedPromise, 1)
        c.mustEqual(failedCb, 1)
        done()
      }, 50)
    })
  })

  describe('High water limit', function () {
    it('Should support highWater set to 0', function () {
      c = makeTest({maxConcurrent: 1, minTime: 0, highWater: 0, rejectOnDrop: false})

      return c.limiter.ready()
      .then(function () {
        var first = c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 1), 1)
        c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 2), 2)
        c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 3), 3)
        c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 4), 4)

        return first
      })
      .then(function () {
        return c.last({ weight: 0 })
      })
      .then(function (results) {
        c.checkDuration(50)
        c.checkResultsOrder([[1]])
      })
    })

    it('Should support highWater set to 1', function () {
      c = makeTest({maxConcurrent: 1, minTime: 0, highWater: 1, rejectOnDrop: false})

      return c.limiter.ready()
      .then(function () {
        var first = c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 1), 1)
        c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 2), 2)
        c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 3), 3)
        var last = c.pNoErrVal(c.limiter.schedule(c.slowPromise, 50, null, 4), 4)

        return Promise.all([first, last])
      })
      .then(function () {
        return c.last({ weight: 0 })
      })
      .then(function (results) {
        c.checkDuration(100)
        c.checkResultsOrder([[1], [4]])
      })
    })
  })

  describe('Weight', function () {
    it('Should not add jobs with a weight above the maxConcurrent', function () {
      c = makeTest({maxConcurrent: 2})

      return c.limiter.ready()
      .then(function () {
        c.pNoErrVal(c.limiter.schedule({ weight: 1 }, c.promise, null, 1), 1)
        c.pNoErrVal(c.limiter.schedule({ weight: 2 }, c.promise, null, 2), 2)

        return c.limiter.schedule({ weight: 3 }, c.promise, null, 3)
      })
      .catch(function (err) {
        c.mustEqual(err.message, 'Impossible to add a job having a weight of 3 to a limiter having a maxConcurrent setting of 2')
        return c.last()
      })
      .then(function (results) {
        c.checkDuration(0)
        c.checkResultsOrder([[1], [2]])
      })
    })


    it('Should support custom job weights', function () {
      c = makeTest({maxConcurrent: 2})

      return c.limiter.ready()
      .then(function () {
        c.pNoErrVal(c.limiter.schedule({ weight: 1 }, c.slowPromise, 100, null, 1), 1)
        c.pNoErrVal(c.limiter.schedule({ weight: 2 }, c.slowPromise, 200, null, 2), 2)
        c.pNoErrVal(c.limiter.schedule({ weight: 1 }, c.slowPromise, 100, null, 3), 3)
        c.pNoErrVal(c.limiter.schedule({ weight: 1 }, c.slowPromise, 100, null, 4), 4)
        c.pNoErrVal(c.limiter.schedule({ weight: 0 }, c.slowPromise, 100, null, 5), 5)

        return c.last()
      })
      .then(function (results) {
        c.checkDuration(400)
        c.checkResultsOrder([[1], [2], [3], [4], [5]])
      })
    })

    it('Should overflow at the correct rate', function () {
      c = makeTest({
        maxConcurrent: 2,
        reservoir: 3
      })

      return c.limiter.ready()
      .then(function () {
        c.pNoErrVal(c.limiter.schedule({ weight: 1, id: 1 }, c.slowPromise, 100, null, 1), 1)

        var promise2 = c.limiter.schedule({ weight: 2, id: 2 }, c.slowPromise, 150, null, 2)
        c.pNoErrVal(promise2, 2)

        c.pNoErrVal(c.limiter.schedule({ weight: 1, id: 3 }, c.slowPromise, 100, null, 3), 3)
        c.pNoErrVal(c.limiter.schedule({ weight: 1, id: 4 }, c.slowPromise, 100, null, 4), 4)

        return promise2
        .then(function () {
          c.mustEqual(c.limiter.queued(), 2)
          return c.limiter.currentReservoir()
        })
      })
      .then(function (reservoir) {
        c.mustEqual(reservoir, 0)
        return c.limiter.incrementReservoir(1)
      })
      .then(function () {
        return c.last({ priority: 1, weight: 0 })
      })
      .then(function (results) {
        c.mustEqual(c.limiter.queued(), 1)
        c.checkDuration(250)
        c.checkResultsOrder([[1], [2]])
        return c.limiter.currentReservoir()
      })
      .then(function (reservoir) {
        c.mustEqual(reservoir, 0)
        c.limiter.removeAllListeners('error')
      })
    })
  })

  describe('Expiration', function () {
    it('Should cancel jobs', function () {
      c = makeTest({ maxConcurrent: 2 })
      var t0 = Date.now()

      return c.limiter.ready()
      .then(function () {
        return Promise.all([
          c.pNoErrVal(c.limiter.schedule(c.slowPromise, 150, null, 1), 1),
          c.limiter.schedule({ expiration: 50 }, c.slowPromise, 75, null, 2)
          .then(function () {
            console.log('ERROR: Job still completed')
            return Promise.reject(new Error("Should have timed out."))
          })
          .catch(function (err) {
            c.mustEqual(err.message, 'This job timed out after 50 ms.')
            var duration = Date.now() - t0
            assert(duration > 45 && duration < 80)

            return c.limiter.running()
          })
          .then(function (r) {
            c.mustEqual(r, 1)
          })
        ])
      })
      .then(function () {
        var duration = Date.now() - t0
        assert(duration > 145 && duration < 180)
        return c.limiter.running()
      })
      .then(function (r) {
        c.mustEqual(r, 0)
      })
    })
  })
})
