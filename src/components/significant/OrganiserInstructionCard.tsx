import type { WorkflowState } from "../../types/significantFind";

export default function OrganiserInstructionCard({ workflowState }: { workflowState: WorkflowState }) {
  const instructions = workflowState.significantFindInstructions.trim();
  const phone = workflowState.organiserContactNumber.trim();
  const email = workflowState.organiserEmail.trim();

  if (!instructions && !phone && !email) return null;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/25">
      <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 mb-1.5">
        Organiser instructions
      </p>
      {instructions && (
        <p className="text-sm font-semibold text-amber-950 dark:text-amber-100 leading-relaxed">
          {instructions}
        </p>
      )}
      {(phone || email) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-amber-600 px-4 text-xs font-black uppercase tracking-widest text-white"
            >
              Call organiser
            </a>
          )}
          {email && (
            <a
              href={`mailto:${email}`}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-300 bg-white px-4 text-xs font-black uppercase tracking-widest text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
            >
              Email
            </a>
          )}
        </div>
      )}
    </div>
  );
}
