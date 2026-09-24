// Integration code with the deployment's endpoint and an app's write key.
// Shared by `sa snippet` and the MCP get_integration_snippet tool.

export const SNIPPET_LANGS = ['js', 'html', 'curl', 'kotlin', 'swift'] as const
export type SnippetLang = (typeof SNIPPET_LANGS)[number]

export function integrationSnippet(lang: SnippetLang, origin: string, key: string): string {
  switch (lang) {
    case 'js':
      return `// npm install @serverless-analytics/sdk
import { createAnalytics } from '@serverless-analytics/sdk'

export const analytics = createAnalytics({
  endpoint: '${origin}',
  writeKey: '${key}',
  captureErrors: true,
})

analytics.identify(user.id)
analytics.track('signup', { method: 'email' })`
    case 'html':
      return `<script src="${origin}/sdk/analytics.global.js"></script>
<script>
  const analytics = ServerlessAnalytics.createAnalytics({ endpoint: '${origin}', writeKey: '${key}', autoPageviews: true, captureErrors: true })
</script>`
    case 'curl':
      return `curl -X POST ${origin}/v1/batch \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
  -d '{"context":{"platform":"server"},"events":[{"id":"'$(uuidgen)'","name":"signup","anonymousId":"device-123","properties":{"method":"email"}}]}'`
    case 'kotlin':
      return `// Batch events locally and POST them; keep the same id when retrying.
val body = JSONObject(mapOf(
  "context" to mapOf("platform" to "android", "appVersion" to BuildConfig.VERSION_NAME, "channel" to BuildConfig.FLAVOR),
  "events" to listOf(mapOf("id" to UUID.randomUUID().toString(), "name" to "signup", "anonymousId" to deviceId,
    "timestamp" to System.currentTimeMillis(), "properties" to mapOf("method" to "email"))),
)).toString()
val request = Request.Builder().url("${origin}/v1/batch")
  .header("Authorization", "Bearer ${key}")
  .post(body.toRequestBody("application/json".toMediaType())).build()
client.newCall(request).enqueue(callback)`
    case 'swift':
      return `var request = URLRequest(url: URL(string: "${origin}/v1/batch")!)
request.httpMethod = "POST"
request.setValue("Bearer ${key}", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: [
  "context": ["platform": "ios", "appVersion": appVersion, "channel": "appstore"],
  "events": [["id": UUID().uuidString, "name": "signup", "anonymousId": deviceId,
              "timestamp": Int(Date().timeIntervalSince1970 * 1000), "properties": ["method": "email"]]],
])
URLSession.shared.dataTask(with: request).resume()`
  }
}
