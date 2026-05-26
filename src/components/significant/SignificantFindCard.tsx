import type { Media, SignificantFind } from "../../db";
import { ScaledImage } from "../ScaledImage";
import {
  formatSignificantDate,
  formatSignificantLocation,
  getStatusLabel,
  PATH_COLORS,
  PATH_LABELS,
  STATUS_COLORS,
} from "./significantFindDisplay";

type Props = {
  significantFind: SignificantFind;
  thumbnail?: Media;
  onOpen: () => void;
};

export default function SignificantFindCard({ significantFind: sf, thumbnail, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-amber-700"
    >
      <div className="flex items-stretch gap-0">
        {thumbnail ? (
          <div className="shrink-0 w-24 bg-gray-100 dark:bg-gray-900">
            <ScaledImage
              media={thumbnail}
              className="w-full h-full"
              imgClassName="object-cover w-full h-full"
            />
          </div>
        ) : (
          <div className="shrink-0 w-24 bg-gray-100 dark:bg-gray-900 flex items-center justify-center text-2xl">
            SF
          </div>
        )}
        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-black text-gray-900 group-hover:text-amber-700 truncate leading-tight dark:text-gray-100 dark:group-hover:text-amber-400">
              {sf.findDescription || PATH_LABELS[sf.path]}
            </h2>
            <span className="shrink-0 text-gray-300 dark:text-gray-600 text-lg leading-none mt-0.5">&gt;</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {formatSignificantLocation(sf)}
            {" - "}
            {formatSignificantDate(sf.createdAt)}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <span className={`rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${PATH_COLORS[sf.path]}`}>
              {PATH_LABELS[sf.path]}
            </span>
            <span className={`rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[sf.status]}`}>
              {getStatusLabel(sf.path, sf.status)}
            </span>
          </div>
          {sf.excavationFindings && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 line-clamp-1 italic">{sf.excavationFindings}</p>
          )}
        </div>
      </div>
    </button>
  );
}
