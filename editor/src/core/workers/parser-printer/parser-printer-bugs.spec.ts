import {
  emptyComments,
  isJSXElement,
  isUtopiaJSXComponent,
  JSXAttributes,
  jsxAttributesFromMap,
  jsxAttributeValue,
  UtopiaJSXComponent,
} from '../../shared/element-template'
import { forEachLeft, isRight } from '../../shared/either'
import {
  clearParseResultUniqueIDsAndEmptyBlocks,
  elementsStructure,
  testParseCode,
  testParseThenPrint,
  testParseThenPrintWithoutUids,
} from './parser-printer.test-utils'
import { objectMap, omit } from '../../shared/object-utils'
import { BakedInStoryboardVariableName, BakedInStoryboardUID } from '../../model/scene-utils'
import { isParseSuccess } from '../../shared/project-file-types'

describe('JSX parser', () => {
  it('adds in data-uid attributes for elements in arbitrary code', () => {
    const code = `import * as React from "react";
import { Ellipse, UtopiaUtils, Image, Rectangle, Text, View } from "utopia-api";

export var App = props => {
  return <View style={{ "backgroundColor": "green", "position": "absolute" }} data-uid="xxx">
    {[1, 2, 3].map(n => {
      return <div>{n}</div>
    })}
  </View>
};`
    const parsedCode = testParseCode(code)
    if (!isParseSuccess(parsedCode)) {
      throw new Error(JSON.stringify(parsedCode))
    }
  })
  it('fails on unprettied code', () => {
    const code = `import Button, { LABEL } from "./src/components";
    import * as React from "react";
    import { Ellipse, UtopiaUtils, Image, Rectangle, Text, View } from "utopia-api";

    export var App = props => {
        return <View style={{ "backgroundColor": "green", "position": "absolute" }} data-uid="xxx" />
    };`
    const parsedPlainCode = testParseCode(code)
    if (isParseSuccess(parsedPlainCode)) {
      const topComponent = parsedPlainCode.topLevelElements.find(isUtopiaJSXComponent)
      if (topComponent != null) {
        if (isJSXElement(topComponent.rootElement)) {
          const expectedProps: JSXAttributes = jsxAttributesFromMap({
            style: jsxAttributeValue(
              {
                backgroundColor: 'green',
                position: 'absolute',
              },
              emptyComments,
            ),
            'data-uid': jsxAttributeValue('xxx', emptyComments),
          })
          expect(topComponent.rootElement.props).toEqual(expectedProps)
        } else {
          throw new Error('Root element not a JSX element.')
        }
      } else {
        throw new Error('Not a component.')
      }
    } else {
      throw new Error(JSON.stringify(parsedPlainCode))
    }
  })
  it('parses elements that use props spreading - #1365', () => {
    const nonSpreadCode = `
    import * as React from "react"
    import { Card } from './card'
    const Test = (props) => {
      return <div data-uid='mapper-parent'>
        {props.data.map((entry) => (
          <Card
            data-uid='card'
            style={{ flexBasis: 50 }}
            name={entry.name}
            country={entry.country}
            image={entry.image}
          />
        ))}
      </div>
    }`
    const spreadCode = `
    import * as React from "react"
    import { Card } from './card'
    const Test = (props) => {
      return <div data-uid='mapper-parent'>
        {props.data.map((entry) => (
          <Card
            {...entry}
            data-uid='card'
            style={{ flexBasis: 50 }}
          />
        ))}
      </div>
    }`

    expect(elementsStructure((testParseCode(nonSpreadCode) as any).topLevelElements))
      .toMatchInlineSnapshot(`
      "UNPARSED_CODE
      IMPORT_STATEMENT
      UNPARSED_CODE
      IMPORT_STATEMENT
      UNPARSED_CODE
      UTOPIA_JSX_COMPONENT - Test
        JSX_ELEMENT - div - mapper-parent
          JSX_ARBITRARY_BLOCK
            JSX_ELEMENT - Card - card"
    `)
    expect(elementsStructure((testParseCode(spreadCode) as any).topLevelElements))
      .toMatchInlineSnapshot(`
      "UNPARSED_CODE
      IMPORT_STATEMENT
      UNPARSED_CODE
      IMPORT_STATEMENT
      UNPARSED_CODE
      UTOPIA_JSX_COMPONENT - Test
        JSX_ELEMENT - div - mapper-parent
          JSX_ARBITRARY_BLOCK
            JSX_ELEMENT - Card - card"
    `)
  })
})

describe('JSX printer', () => {
  it('reprints spread object values correctly', () => {
    const code = `import * as React from 'react'
import { Storyboard, View } from 'utopia-api'

const myCoolTheme = {}

export var App = (props) => {
  return (
    <View
      data-uid='xxx'
      style={{ ...myCoolTheme, backgroundColor: 'purple' }}
    />
  )
}

export var ${BakedInStoryboardVariableName} = (
  <Storyboard data-uid='${BakedInStoryboardUID}' />
)
`
    testParseThenPrint('/index.js', code, code)
  })
  it('components are not reordered when printing', () => {
    const code = `import * as React from 'react'
import { Storyboard, View } from 'utopia-api'

export var App = (props) => {
  return <Widget data-uid='bbb' />
}

export var Widget = (props) => {
  return <View data-uid='aaa' />
}

export var ${BakedInStoryboardVariableName} = (
  <Storyboard data-uid='${BakedInStoryboardUID}' />
)
`
    testParseThenPrint('/index.js', code, code)
  })

  it('object property names with special characters should be printed in string quotes', () => {
    const code = `import * as React from 'react'
import { Storyboard, View } from 'utopia-api'

const color = 'white'

export var App = (props) => {
  return (
    <View
      data-uid='aaa'
      css={{
        backgroundColor: 'regular propety, without quotes',
        '& :hover': { color: color },
      }}
    />
  )
}

export var ${BakedInStoryboardVariableName} = (
  <Storyboard data-uid='${BakedInStoryboardUID}' />
)
`
    testParseThenPrint('/index.js', code, code)
  })

  it('definedWithin and definedElsewhere are mutually exclusive properties', () => {
    const code = `import * as React from 'react'
import { Storyboard, View } from 'utopia-api'

export var App = (props) => {
  return (
    <View data-uid='aaa' css={{ backgroundColor: 'red' }}>
      <View data-uid='bbb'>
        {elements.map((e) => null)}
      </View>
    </View>
  )
}

const elements = []
export var ${BakedInStoryboardVariableName} = (
  <Storyboard data-uid='${BakedInStoryboardUID}' />
)
`
    testParseThenPrint('/index.js', code, code)
  })
  it('parses elements that use props spreading - #1365', () => {
    const spreadCode = `import * as React from 'react'
const Test = (props) => {
  return (
    <div data-uid='mapper-parent'>
      {props.data.map((entry) => (
        <div
          {...entry}
          data-uid='card'
          style={{ flexBasis: 50 }}
        />
      ))}
    </div>
  )
}

export var ${BakedInStoryboardVariableName} = (
  <Storyboard data-uid='${BakedInStoryboardUID}' />
)
`

    testParseThenPrint('/index.js', spreadCode, spreadCode)
  })
  it('parses elements that use props spreading without an explicit uid - #1515', () => {
    const spreadCode = `import * as React from 'react'
const Test = (props) => {
  return (
    <div>
      {props.data.map((entry) => (
        <div {...entry} style={{ flexBasis: 50 }} />
      ))}
    </div>
  )
}

export var ${BakedInStoryboardVariableName} = <Storyboard />
`

    testParseThenPrintWithoutUids('/index.js', spreadCode, spreadCode)
  })

  it('#1737 - Produces the same value for an exported default function', () => {
    const spreadCode = `import * as React from 'react'
export default function () {
  return (
    <div>
      <div>Default Function Time</div>
    </div>
  )
}
`

    testParseThenPrintWithoutUids('/index.js', spreadCode, spreadCode)
  })

  it('#1773 - Handles imports which relate to the same file but have differing paths.', () => {
    const spreadCode = `import * as React from 'react'
import { FirstComponent } from './components.js'
import { SecondComponent } from '/components.js'
export default function () {
  return (
    <div>
      <div>Default Function Time</div>
    </div>
  )
}
`

    testParseThenPrintWithoutUids('/index.js', spreadCode, spreadCode)
  })
})

describe('Imports', () => {
  it('side-effects-only imports work', () => {
    const code = `import './style.css'
import * as React from 'react'
import { Storyboard, View } from 'utopia-api'

export var App = (props) => {
  return (
    <View data-uid='aaa' css={{ backgroundColor: 'red' }}>
      <View data-uid='bbb'>
        {elements.map((e) => null)}
      </View>
    </View>
  )
}

const elements = []
export var ${BakedInStoryboardVariableName} = (
  <Storyboard data-uid='${BakedInStoryboardUID}' />
)
`
    testParseThenPrint('/index.js', code, code)
  })
})
