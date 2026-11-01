import { useRef, useState } from 'react';
import Navigation from '../components/Navigation';
import ClassificationLabeling from './ClassificationLabeling';
import SegmentationEditor from '../components/SegmentationEditor';

export default function Labeling() {
  const [mode, setMode] = useState('classification');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [segmentationMounted, setSegmentationMounted] = useState(false);
  const [switching, setSwitching] = useState(false);
  const segmentation = useRef(null);
  const selectMode = async (next) => {
    if (mode === next || switching) return;
    setSwitching(true);
    try {
      if (mode === 'segmentation' && !(await segmentation.current?.prepareLeave())) return;
      if (next === 'segmentation') setSegmentationMounted(true);
      setMode(next);
    } finally { setSwitching(false); }
  };
  return <div className="flex min-h-screen bg-gray-50">
    <Navigation />
    <div className="flex flex-1 min-w-0 flex-col h-screen overflow-hidden">
      <div role="tablist" aria-label="Chế độ gán nhãn" className="grid grid-cols-2 shrink-0 bg-white border-b border-gray-200">
        {[['classification', 'Gán nhãn theo lớp (Classification)'], ['segmentation', 'Gán nhãn theo vùng (Segmentation)']].map(([id, title]) => <button key={id} id={`tab-${id}`} role="tab" aria-selected={mode === id} aria-controls={`panel-${id}`} disabled={switching} onClick={() => selectMode(id)} className={`px-4 py-4 text-sm font-semibold border-b-2 transition-colors ${mode === id ? 'text-blue-600 border-blue-600 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'}`}>{title}</button>)}
      </div>
      <div id="panel-classification" role="tabpanel" aria-labelledby="tab-classification" className={`${mode === 'classification' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}>
        <ClassificationLabeling selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId} active={mode === 'classification'} />
      </div>
      {segmentationMounted && <div id="panel-segmentation" role="tabpanel" aria-labelledby="tab-segmentation" className={`${mode === 'segmentation' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}>
        <SegmentationEditor ref={segmentation} selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId} />
      </div>}
    </div>
  </div>;
}
