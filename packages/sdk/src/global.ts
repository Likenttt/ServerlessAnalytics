// <script> build: exposes window.ServerlessAnalytics.createAnalytics
import { createAnalytics } from './index'
;(globalThis as Record<string, unknown>).ServerlessAnalytics = { createAnalytics }
