declare module 'rtf.js' {
  export namespace WMFJS {
    function loggingEnabled(enabled: boolean): void;
    class Renderer {
      constructor(blob: ArrayBuffer);
      render(settings: {
        width: string;
        height: string;
        xExt: number;
        yExt: number;
        mapMode: number;
      }): SVGElement;
    }
  }
}
