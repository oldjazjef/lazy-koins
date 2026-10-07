import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FileGuide } from './file-guide';

async function render(open?: boolean) {
  TestBed.configureTestingModule({
    imports: [FileGuide],
    providers: [provideTranslateService()],
  });
  const fixture = TestBed.createComponent(FileGuide);
  if (open !== undefined) fixture.componentRef.setInput('open', open);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('FileGuide (what to download from the platforms)', () => {
  it('is collapsed by default and lists what is needed', async () => {
    const el = await render();
    const details = el.querySelector('details');
    expect(details?.open).toBe(false);
    const text = el.textContent ?? '';
    for (const key of [
      'files.guide.need.transactions',
      'files.guide.need.trades',
      'files.guide.need.transfers',
      'files.guide.need.rewards',
      'files.guide.need.statement',
    ]) {
      expect(text).toContain(key);
    }
  });

  it('opens when asked (a project without files)', async () => {
    const el = await render(true);
    expect(el.querySelector('details')?.open).toBe(true);
  });
});
