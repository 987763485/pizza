import type { PizzaApi } from '@shared/ipc'

declare global {
  interface Window {
    pizza: PizzaApi
    pizzaBootstrap?: {
      theme: string | null
      language: string | null
      platform: string | null
    }
  }
}

export {}
