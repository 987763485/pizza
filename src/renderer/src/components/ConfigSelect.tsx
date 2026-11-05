import { Fragment, useEffect, useRef, useState } from 'react'
import type { RuntimeAdapterId } from '@shared/types'
import { Icon, type IconName } from './Icon'
import { RuntimeLogo } from './RuntimeLogo'

export interface ConfigSelectOption {
  value: string
  label: string
  icon?: IconName
  /** 有品牌图标时优先显示品牌图标。 */
  logoAdapter?: RuntimeAdapterId
  disabled?: boolean
  /** 同一组连续出现时只显示一次组标题。 */
  group?: string
}

interface ConfigSelectProps {
  value: string
  options: ConfigSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  leadingIcon?: IconName
  leadingLogoAdapter?: RuntimeAdapterId
  placeholder?: string
  /** 运行时选择器右侧的在线状态点。 */
  status?: 'online' | 'offline' | null
  disabled?: boolean
  /** 模型很多时在菜单内提供搜索框。 */
  searchable?: boolean
  searchPlaceholder?: string
  /** 允许把输入的任意模型 ID 直接作为选项提交。 */
  allowCustomValue?: boolean
  customValueLabel?: (value: string) => string
  /** 菜单内的刷新按钮，用于重新发现运行时模型。 */
  onRefresh?: () => void
  refreshing?: boolean
  refreshLabel?: string
}

/**
 * 设置页使用的轻量下拉选择器。
 *
 * 原生 select 无法在选项/触发器里放图标，这里用按钮 + 列表实现，
 * 并复用页面已有的表面、边框与悬停样式。
 */
export function ConfigSelect({
  value,
  options,
  onChange,
  ariaLabel,
  leadingIcon,
  leadingLogoAdapter,
  placeholder,
  status,
  disabled = false,
  searchable = false,
  searchPlaceholder,
  allowCustomValue = false,
  customValueLabel,
  onRefresh,
  refreshing = false,
  refreshLabel,
}: ConfigSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    searchRef.current?.focus()
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleOptions = normalizedQuery
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(normalizedQuery) ||
          option.value.toLowerCase().includes(normalizedQuery),
      )
    : options
  // 输入不在目录中的模型 ID 时，把它作为临时模型提交。
  const customValue =
    allowCustomValue &&
    query.trim() &&
    !options.some((option) => option.value.toLowerCase() === normalizedQuery)
      ? query.trim()
      : null

  const commit = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <div className="config-select" ref={rootRef}>
      <button
        type="button"
        className="config-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {selected?.logoAdapter || leadingLogoAdapter ? (
          <RuntimeLogo
            adapter={(selected?.logoAdapter ?? leadingLogoAdapter) as RuntimeAdapterId}
            size={15}
            className="runtime-logo-inline"
          />
        ) : (
          <Icon name={selected?.icon ?? leadingIcon ?? 'box'} size={15} />
        )}
        <span className={`config-select-value ${selected ? '' : 'placeholder'}`}>
          {selected?.label ?? (value || placeholder)}
        </span>
        {status ? <span className={`status-dot ${status}`} /> : null}
        <Icon name="chevron-down" size={14} className="config-select-chevron" />
      </button>

      {open ? (
        <div
          className={`config-select-menu ${searchable || onRefresh ? 'with-search' : ''}`}
          role="listbox"
          aria-label={ariaLabel}
        >
          {searchable || onRefresh ? (
            <div className="config-select-search">
              {searchable ? (
                <>
                  <Icon name="search" size={14} />
                  <input
                    ref={searchRef}
                    className="config-select-search-input"
                    value={query}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder ?? ariaLabel}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      const first = visibleOptions.find((option) => !option.disabled)
                      if (customValue) commit(customValue)
                      else if (first) commit(first.value)
                    }}
                  />
                </>
              ) : null}
              {onRefresh ? (
                <button
                  type="button"
                  className="icon-btn config-select-refresh"
                  title={refreshLabel ?? ariaLabel}
                  aria-label={refreshLabel ?? ariaLabel}
                  disabled={refreshing}
                  onClick={onRefresh}
                >
                  <Icon
                    name={refreshing ? 'loader' : 'refresh'}
                    size={15}
                    className={refreshing ? 'spin' : undefined}
                  />
                </button>
              ) : null}
            </div>
          ) : null}
          {visibleOptions.map((option, index) => (
            <Fragment key={option.value || `empty-${index}`}>
              {option.group && option.group !== visibleOptions[index - 1]?.group ? (
                <div className="config-select-group">{option.group}</div>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`config-select-option ${option.value === value ? 'active' : ''}`}
                disabled={option.disabled}
                onClick={() => commit(option.value)}
              >
                {option.logoAdapter ? (
                  <RuntimeLogo
                    adapter={option.logoAdapter}
                    size={14}
                    className="runtime-logo-inline"
                  />
                ) : option.icon ? (
                  <Icon name={option.icon} size={14} />
                ) : null}
                <span>{option.label}</span>
                {option.value === value ? <Icon name="check" size={13} /> : null}
              </button>
            </Fragment>
          ))}
          {customValue ? (
            <button
              type="button"
              role="option"
              aria-selected={value === customValue}
              className={`config-select-option ${value === customValue ? 'active' : ''}`}
              onClick={() => commit(customValue)}
            >
              <Icon name="cpu" size={14} />
              <span>
                {customValueLabel ? customValueLabel(customValue) : customValue}
              </span>
            </button>
          ) : null}
          {visibleOptions.length === 0 && !customValue ? (
            <div className="config-select-empty">{placeholder}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
