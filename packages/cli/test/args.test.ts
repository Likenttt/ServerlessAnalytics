import { describe, expect, it } from 'vitest'
import { Args, parseArgs, parseKeyValue } from '../src/args.js'
import { parseProp } from '../src/commands/apps.js'

describe('args', () => {
  it('parses positionals, repeated flags, = syntax and switches', () => {
    const a = new Args(parseArgs(['query', 'funnel', 'app', '--step', 'a', '--step=b', '--json', '--no-open', '--', '--raw'], new Set(['json'])))
    expect(a.positionals).toEqual(['query', 'funnel', 'app', '--raw'])
    expect(a.all('step')).toEqual(['a', 'b'])
    expect(a.has('json') && a.has('no-open')).toBe(true)
  })

  it('types key=value pairs', () => {
    expect(parseKeyValue('n=42')).toEqual(['n', 42])
    expect(parseKeyValue('ok=true')).toEqual(['ok', true])
    expect(parseKeyValue('plan=pro')).toEqual(['plan', 'pro'])
    expect(parseKeyValue('id=')).toEqual(['id', ''])
    expect(parseKeyValue('tags:=["a","b"]')).toEqual(['tags', ['a', 'b']])
  })

  it('parses property specs', () => {
    expect(parseProp('amount:number:required:In USD')).toEqual({ name: 'amount', type: 'number', required: true, description: 'In USD' })
    expect(parseProp('note')).toEqual({ name: 'note', type: 'any', required: false, description: '' })
    expect(() => parseProp('x:date')).toThrow('type must be one of')
  })
})
