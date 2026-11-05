// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfigSelect } from '../../src/renderer/src/components/ConfigSelect'

const options = [
  { value: '', label: 'Managed by the runtime', icon: 'sparkle' as const },
  { value: 'p/sonnet', label: 'p/sonnet', icon: 'cpu' as const, group: 'p' },
  { value: 'p/opus', label: 'p/opus', icon: 'cpu' as const, group: 'p' },
]

function renderSearchable(onChange = vi.fn(), onRefresh = vi.fn()) {
  render(
    <ConfigSelect
      value=""
      options={options}
      onChange={onChange}
      ariaLabel="Model"
      searchable
      searchPlaceholder="Search or type a model ID"
      allowCustomValue
      customValueLabel={(id) => `Use model ID ${id}`}
      onRefresh={onRefresh}
      refreshLabel="Refresh models"
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  return {
    onChange,
    onRefresh,
    search: screen.getByPlaceholderText('Search or type a model ID'),
  }
}

describe('ConfigSelect', () => {
  it('filters options and commits a model ID that is not in the catalog', () => {
    const { onChange, search } = renderSearchable()

    fireEvent.change(search, { target: { value: 'opus' } })
    expect(screen.getByRole('option', { name: 'p/opus' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'p/sonnet' })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'vendor/custom-model' } })
    fireEvent.click(
      screen.getByRole('option', { name: 'Use model ID vendor/custom-model' }),
    )
    expect(onChange).toHaveBeenCalledWith('vendor/custom-model')
    expect(
      screen.queryByPlaceholderText('Search or type a model ID'),
    ).not.toBeInTheDocument()
  })

  it('refreshes the catalog without closing the menu', () => {
    const { onRefresh, search } = renderSearchable()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }))

    expect(onRefresh).toHaveBeenCalledOnce()
    expect(search).toBeInTheDocument()
  })
})
