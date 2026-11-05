// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/i18n'
import { ApprovalDialog } from '../../src/renderer/src/components/ApprovalDialog'
import { useAppStore } from '../../src/renderer/src/store'
import type { ApprovalRequest } from '../../src/shared/types'

const request: ApprovalRequest = {
  id: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  agentId: '44444444-4444-4444-8444-444444444444',
  agentName: 'Agent',
  toolName: 'Bash',
  toolInputSummary: 'command: echo test',
  risk: 'high',
  policySource: 'default',
  status: 'pending',
  decision: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
}

beforeEach(() => {
  useAppStore.setState({ approvals: [request] })
  ;(window as unknown as { pizza: unknown }).pizza = {
    approval: {
      decide: vi.fn(async () => ({ ...request, status: 'allowed', decision: 'deny' })),
    },
  }
})

describe('ApprovalDialog', () => {
  it('shows the queued approval and sends the chosen decision', async () => {
    render(<ApprovalDialog />)
    expect(screen.getByText('工具调用需要审批')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('高风险')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '允许一次' }))
    expect(window.pizza.approval.decide).toHaveBeenCalledWith({
      approvalId: request.id,
      decision: 'allow_once',
    })
    await vi.waitFor(() => {
      expect(useAppStore.getState().approvals).toHaveLength(0)
    })
  })
})
