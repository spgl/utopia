/** @jsxRuntime classic */
/** @jsx jsx */
import React from 'react'
import { css, jsx } from '@emotion/react'
import { Component as ReactComponent } from 'react'
import {
  Menu,
  Item,
  Submenu as SubmenuComponent,
  contextMenu,
  useContextMenu,
} from 'react-contexify'
import { ContextMenuItem } from './context-menu-items'
import { EditorDispatch } from './editor/action-types'
import fastDeepEquals from 'fast-deep-equal'
import { Icons, UtopiaTheme } from '../uuiui'
import { getControlStyles } from '../uuiui-deps'

export interface ContextMenuWrapperProps<T> {
  id: string
  items: Array<ContextMenuItem<T>>
  dispatch?: EditorDispatch
  data: T
  renderTag?: string
  className?: string
  innerClassName?: string
  style?: React.CSSProperties
  providerStyle?: React.CSSProperties
}

export interface ContextMenuProps<T> {
  id: string
  items: Array<ContextMenuItem<T>>
  dispatch?: EditorDispatch
  getData: () => T
}

interface Submenu<T> {
  type: 'submenu'
  label: string
  items: Array<ContextMenuItem<T>>
}

interface SimpleItem<T> {
  type: 'simple'
  item: ContextMenuItem<T>
}

export class MomentumContextMenu<T> extends ReactComponent<ContextMenuProps<T>> {
  shouldComponentUpdate(nextProps: ContextMenuProps<T>) {
    const result = !fastDeepEquals(this.props.items, nextProps.items)
    return result
  }

  splitItemsForSubmenu(items: Array<ContextMenuItem<T>>): Array<Submenu<T> | SimpleItem<T>> {
    let splitItems: Array<Submenu<T> | SimpleItem<T>> = []
    for (const item of items) {
      if (item.submenuName != null) {
        const alreadyAdded = splitItems.find(
          (alreadySplit: any) =>
            alreadySplit.type === 'submenu' && alreadySplit.label === item.submenuName,
        )
        if (alreadyAdded != null && alreadyAdded.type === 'submenu') {
          alreadyAdded.items.push(item)
        } else {
          splitItems.push({
            type: 'submenu',
            label: item.submenuName!,
            items: [item],
          })
        }
      } else {
        splitItems.push({
          type: 'simple',
          item: item,
        })
      }
    }
    return splitItems
  }

  isHidden = (item: ContextMenuItem<T>): (() => boolean) => {
    return () => {
      if (item.isHidden == null) {
        return false
      } else if (typeof item.isHidden === 'function') {
        return item.isHidden(this.props.getData())
      } else {
        return item.isHidden
      }
    }
  }

  isDisabled = (item: ContextMenuItem<T>): (() => boolean) => {
    return () => {
      if (typeof item.enabled === 'function') {
        return !item.enabled(this.props.getData())
      } else {
        return !item.enabled
      }
    }
  }

  renderItem(item: ContextMenuItem<T>, index: number) {
    return (
      <Item
        key={`context-menu-${index}-item`}
        disabled={this.isDisabled(item)}
        // eslint-disable-next-line react/jsx-no-bind
        onClick={({ event }) => {
          event.stopPropagation()
          item.action(this.props.getData(), this.props.dispatch, (event as any)?.nativeEvent)
          contextMenu.hideAll()
        }}
        hidden={this.isHidden(item)}
        style={{ height: item.isSeparator ? 9 : 24, display: 'flex', alignItems: 'center' }}
      >
        <span style={{ flexGrow: 1, flexShrink: 0 }} className='react-contexify-span'>
          {item.name}
        </span>
        <span style={{ flexGrow: 0, flexShrink: 0, opacity: 0.6 }} className='shortcut'>
          {item.shortcut}
        </span>
      </Item>
    )
  }

  render() {
    const { id } = this.props
    const items = this.splitItemsForSubmenu(this.props.items)
    return (
      <Menu key={id} id={id} animation={false}>
        {items.map((item: Submenu<T> | SimpleItem<T>, index: number) => {
          if (item.type === 'submenu') {
            return (
              <SubmenuComponent
                key={`context-menu-${index}`}
                label={
                  <span style={{ height: 24, display: 'flex', alignItems: 'center' }}>
                    {item.label}
                  </span>
                }
                arrow={<Icons.ExpansionArrowRight style={{ marginLeft: 8 }} />}
              >
                {item.items.map((submenuItem, submenuIndex) =>
                  this.renderItem(submenuItem, submenuIndex),
                )}
              </SubmenuComponent>
            )
          } else {
            return this.renderItem(item.item, index)
          }
        })}
      </Menu>
    )
  }
}

export class ContextMenuWrapper<T> extends ReactComponent<
  ContextMenuWrapperProps<T> & { dispatch: EditorDispatch }
> {
  getData = () => this.props.data
  render() {
    const name = `${this.props.id}-context-menu-wrapper`
    return (
      <div
        key={name}
        className={name + ' ' + (this.props.className ?? '')}
        style={this.props.style}
      >
        <MenuProvider
          key={`${this.props.id}-provider`}
          id={this.props.id}
          style={this.props.providerStyle}
          itemsLength={this.props.items.length}
        >
          {this.props.children}
        </MenuProvider>
        <MomentumContextMenu
          key={`${this.props.id}`}
          id={this.props.id}
          items={this.props.items}
          dispatch={this.props.dispatch}
          getData={this.getData}
        />
      </div>
    )
  }
}

export class InspectorContextMenuWrapper<T> extends ReactComponent<ContextMenuWrapperProps<T>> {
  getData = () => this.props.data
  render() {
    const name = `${this.props.id}-context-menu-wrapper`
    return (
      <div
        key={name}
        className={name + ' ' + (this.props.className ?? '')}
        css={{
          width: '100%',
          ...this.props.style,
        }}
      >
        <React.Fragment>
          <MenuProvider
            key={`${this.props.id}-provider`}
            id={this.props.id}
            itemsLength={this.props.items.length}
            style={{
              width: '100%',
              height: '100%',
            }}
          >
            {this.props.children}
          </MenuProvider>
          <MomentumContextMenu
            key={`${this.props.id}`}
            id={this.props.id}
            items={this.props.items}
            getData={this.getData}
          />
        </React.Fragment>
      </div>
    )
  }
}

interface MenuProviderProps {
  id: string
  itemsLength: number
  style?: React.CSSProperties
}

export const MenuProvider: React.FunctionComponent<MenuProviderProps> = (props) => {
  const { show } = useContextMenu({ id: props.id })
  const onContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (props.itemsLength > 0) {
        show(event)
      }
    },
    [props.itemsLength, show],
  )

  return (
    <div style={props.style} onContextMenu={onContextMenu}>
      {props.children}
    </div>
  )
}
