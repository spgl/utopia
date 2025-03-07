import React from 'react'
import * as EP from '../../../../core/shared/element-path'
import { ElementPath } from '../../../../core/shared/project-file-types'
import { when } from '../../../../utils/react-conditionals'
import { useColorTheme } from '../../../../uuiui'
import { useEditorState } from '../../../editor/store/store-hook'
import { useBoundingBox } from '../bounding-box-hooks'
import { CanvasOffsetWrapper } from '../canvas-offset-wrapper'
import { getSelectionColor } from '../outline-control'

interface MultiSelectOutlineControlProps {
  localSelectedElements: Array<ElementPath>
}

export const MultiSelectOutlineControl = React.memo<MultiSelectOutlineControlProps>((props) => {
  const localSelectedElements = props.localSelectedElements
  return (
    <CanvasOffsetWrapper>
      {[
        <OutlineControl
          key='multiselect-outline'
          targets={localSelectedElements}
          color='multiselect-bounds'
        />,
        ...localSelectedElements.map((path) => (
          <OutlineControl key={EP.toString(path)} targets={[path]} color='primary' />
        )),
      ]}
    </CanvasOffsetWrapper>
  )
})

interface OutlineControlProps {
  targets: Array<ElementPath>
  color: 'primary' | 'multiselect-bounds'
}

const OutlineControl = React.memo<OutlineControlProps>((props) => {
  const colorTheme = useColorTheme()
  const targets = props.targets
  const scale = useEditorState((store) => store.editor.canvas.scale, 'OutlineControl scale')

  const colors = useEditorState((store) => {
    return targets.map((path) =>
      getSelectionColor(
        path,
        store.editor.jsxMetadata,
        store.editor.focusedElementPath,
        colorTheme,
      ),
    )
  }, 'OutlineControl colors')

  const outlineRef = useBoundingBox(targets, (ref, boundingBox) => {
    ref.current.style.left = `${boundingBox.x + 0.5 / scale}px`
    ref.current.style.top = `${boundingBox.y + 0.5 / scale}px`
    ref.current.style.width = `${boundingBox.width - (0.5 / scale) * 3}px`
    ref.current.style.height = `${boundingBox.height - (0.5 / scale) * 3}px`
  })

  const color =
    props.color === 'primary' ? colors[0] : colorTheme.canvasSelectionSecondaryOutline.value

  if (targets.length > 0) {
    return (
      <div
        ref={outlineRef}
        className='role-outline'
        style={{
          position: 'absolute',
          boxSizing: 'border-box',
          boxShadow: `0px 0px 0px ${1 / scale}px ${color}`,
          pointerEvents: 'none',
        }}
      />
    )
  }
  return null
})
