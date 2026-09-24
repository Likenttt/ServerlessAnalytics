import { Hono } from 'hono'
import { apiError, readBody, type AppEnv } from '../http.js'
import { verifyQstashSignature } from '../queue.js'
import { consumeQueueBodies, runRetention } from '../services.js'
import { safeEqual } from '../util.js'

// Machine-to-machine endpoints: QStash deliveries and scheduled jobs on
// platforms without native cron handlers (Vercel Cron).

export const internalRoutes = new Hono<AppEnv>()

internalRoutes.post('/queue/qstash', async (c) => {
  const services = c.get('services')
  const queue = services.config.queue
  if (queue.driver !== 'qstash') throw apiError(404, 'not_found', 'QStash queue is not enabled')
  const body = await readBody(c.req.raw, 2_000_000)
  if (!(await verifyQstashSignature(c.req.header('upstash-signature'), body, queue))) {
    throw apiError(401, 'invalid_signature', 'Invalid QStash signature')
  }
  // Throwing here returns 500, which makes QStash retry the delivery.
  const inserted = await consumeQueueBodies(services, [JSON.parse(body)])
  return c.json({ inserted })
})

internalRoutes.on(['GET', 'POST'], '/cron/retention', async (c) => {
  const services = c.get('services')
  const secret = services.config.cronSecret
  const auth = c.req.header('authorization') ?? ''
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw apiError(401, 'unauthorized', 'Invalid cron secret')
  return c.json(await runRetention(services))
})
