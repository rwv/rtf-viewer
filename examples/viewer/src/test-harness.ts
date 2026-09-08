import { RtfDocument } from 'rtf-viewer';
import { RtfViewer } from 'rtf-viewer/viewer';
import './styles.css';

const canvas = document.querySelector<HTMLCanvasElement>('#test-canvas');
if (!canvas) throw new Error('The test canvas is missing.');

const viewer = new RtfViewer(canvas);

declare global {
  interface Window {
    __rtfTest: {
      RtfDocument: typeof RtfDocument;
      RtfViewer: typeof RtfViewer;
      viewer: RtfViewer;
    };
  }
}

window.__rtfTest = { RtfDocument, RtfViewer, viewer };
