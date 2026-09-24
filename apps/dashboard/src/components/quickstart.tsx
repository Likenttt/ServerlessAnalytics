import { useState } from 'react'
import { CodeBlock, Segmented } from './ui'

type Lang = 'curl' | 'js' | 'kotlin' | 'swift'

export function Quickstart({ writeKey }: { writeKey: string }) {
  const [lang, setLang] = useState<Lang>('curl')
  const origin = window.location.origin
  const snippets: Record<Lang, string> = {
    curl: `curl -X POST ${origin}/v1/batch \\
  -H "Authorization: Bearer ${writeKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"events":[{"name":"signup","anonymousId":"device-123","properties":{"plan":"pro"}}]}'`,
    js: `import { createAnalytics } from '@serverless-analytics/sdk'

const analytics = createAnalytics({
  endpoint: '${origin}',
  writeKey: '${writeKey}',
})

analytics.track('signup', { plan: 'pro' })`,
    kotlin: `// OkHttp — batch events and send them in the background.
val body = """{"events":[{"id":"${'$'}{UUID.randomUUID()}","name":"signup",
  "anonymousId":"${'$'}deviceId","timestamp":${'$'}{System.currentTimeMillis()},
  "context":{"platform":"android","appVersion":"${'$'}{BuildConfig.VERSION_NAME}"}}]}"""
val request = Request.Builder()
  .url("${origin}/v1/batch")
  .header("Authorization", "Bearer ${writeKey}")
  .post(body.toRequestBody("application/json".toMediaType()))
  .build()
client.newCall(request).enqueue(callback)`,
    swift: `var request = URLRequest(url: URL(string: "${origin}/v1/batch")!)
request.httpMethod = "POST"
request.setValue("Bearer ${writeKey}", forHTTPHeaderField: "Authorization")
request.setValue("application/json", forHTTPHeaderField: "Content-Type")
request.httpBody = try JSONSerialization.data(withJSONObject: [
  "events": [[
    "id": UUID().uuidString, "name": "signup", "anonymousId": deviceId,
    "timestamp": Int(Date().timeIntervalSince1970 * 1000),
    "context": ["platform": "ios", "appVersion": appVersion],
  ]],
])
URLSession.shared.dataTask(with: request).resume()`,
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <Segmented
        label="Language"
        value={lang}
        onChange={setLang}
        options={[
          { value: 'curl', label: 'cURL' },
          { value: 'js', label: 'JavaScript' },
          { value: 'kotlin', label: 'Android' },
          { value: 'swift', label: 'iOS' },
        ]}
      />
      <div className="w-full">
        <CodeBlock code={snippets[lang]} />
      </div>
    </div>
  )
}
