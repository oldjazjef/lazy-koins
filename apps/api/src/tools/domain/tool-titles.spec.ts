import { toolSetup } from '../testing/tool-fixture';
import { TOOL_TITLES_EN, toolTitle, toolTitles } from './tool-titles';

describe('tool titles per language (F11.2)', () => {
  it('has an English title for every tool, and none for a tool that is gone', async () => {
    const t = await toolSetup();
    const names = t.registry.all().map((tool) => tool.name);
    expect(names.filter((name) => !TOOL_TITLES_EN[name])).toEqual([]);
    expect(
      Object.keys(TOOL_TITLES_EN).filter((name) => !names.includes(name)),
    ).toEqual([]);
  });

  it('keeps the German title for de-CH', () => {
    const tool = { name: 'get_result', title: 'Ergebnis' };
    expect(toolTitle(tool, 'de-CH')).toBe('Ergebnis');
    expect(toolTitle(tool, 'en')).toBe('Result');
    expect(toolTitles({ name: 'unknown', title: 'Unbekannt' })).toEqual({
      'de-CH': 'Unbekannt',
      en: 'Unbekannt',
    });
  });
});
