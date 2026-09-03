import InfoIcon from './InfoIcon.jsx';

/**
 * Empty state. The dashed box is only an affordance — the drop handler lives on
 * the whole window (App.jsx).
 */
export default function DropZone({ onChoose, onAbout }) {
  return (
    <div className="relative flex flex-1 items-center justify-center bg-neutral-950">
      <div className="flex w-[440px] flex-col items-center gap-3 rounded-lg border-2 border-dashed
                      border-neutral-800 px-10 py-14">
        <div className="mb-1 text-3xl text-neutral-700" aria-hidden>▣</div>
        <p className="text-[15px] text-neutral-300">Drop a video here</p>
        <p className="text-[12px] text-neutral-600">MP4 · MOV · MKV · AVI · WebM · TS</p>
        <button
          type="button"
          onClick={onChoose}
          className="mt-3 rounded border border-neutral-700 px-4 py-1.5 text-[13px] text-neutral-300
                     transition-colors hover:border-neutral-600 hover:bg-neutral-800"
        >
          Choose file…
        </button>
        <p className="text-[11px] text-neutral-700">or press Ctrl+O</p>
      </div>

      {/* The left rail carries About once a file is loaded, but it isn't
          rendered yet — so the empty state needs its own way in. */}
      <button
        type="button"
        onClick={onAbout}
        className="absolute bottom-4 left-4 flex items-center gap-1.5 rounded border
                   border-neutral-800 px-3 py-1.5 text-[13px] text-neutral-400
                   transition-colors hover:border-neutral-600 hover:bg-neutral-900
                   hover:text-neutral-200"
        title="Version, source and updates"
      >
        <InfoIcon />
        About
      </button>
    </div>
  );
}
