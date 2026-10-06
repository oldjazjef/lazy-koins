import { allowPrintRequest, toElectronPrintOptions } from './print-options';

describe('toElectronPrintOptions', () => {
  it('maps the API options to Electron: A4, inches, header/footer on', () => {
    expect(
      toElectronPrintOptions({
        format: 'A4',
        printBackground: true,
        marginMm: { top: 14, bottom: 16, left: 12, right: 12 },
        headerTemplate: '<span></span>',
        footerTemplate: '<div><span class="pageNumber"></span></div>',
      }),
    ).toEqual({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.5512, bottom: 0.6299, left: 0.4724, right: 0.4724 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div><span class="pageNumber"></span></div>',
      preferCSSPageSize: false,
    });
  });

  it('switches header/footer off when both templates are empty', () => {
    expect(
      toElectronPrintOptions({
        format: 'A4',
        printBackground: true,
        marginMm: { top: 0, bottom: 0, left: 0, right: 0 },
        headerTemplate: '',
        footerTemplate: '',
      }).displayHeaderFooter,
    ).toBe(false);
  });
});

describe('allowPrintRequest', () => {
  const doc = 'file:///C:/Temp/lk-pdf-abc.html';
  it('lets only the document itself load (offline print)', () => {
    expect(allowPrintRequest(doc, doc)).toBe(true);
    expect(allowPrintRequest('https://example.com/x.png', doc)).toBe(false);
    expect(allowPrintRequest('file:///C:/Users/anna/secret.txt', doc)).toBe(
      false,
    );
    expect(allowPrintRequest('data:image/png;base64,AAAA', doc)).toBe(false);
  });
});
