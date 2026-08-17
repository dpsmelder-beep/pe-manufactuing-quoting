export const PROJECT_TYPES = {
  wire_harness: 'Wire Harness',
  cnc_machining: 'CNC Machining',
  pcb_population: 'PCB Population',
  box_build: 'Box Build',
};

export const PROJECT_TYPE_COLORS = {
  wire_harness: 'bg-blue-100 text-blue-800',
  cnc_machining: 'bg-orange-100 text-orange-800',
  pcb_population: 'bg-green-100 text-green-800',
  box_build: 'bg-purple-100 text-purple-800',
};

export const STATUSES = {
  new: { label: 'New', badgeClass: 'bg-blue-100 text-blue-800' },
  in_review: { label: 'In Review', badgeClass: 'bg-yellow-100 text-yellow-800' },
  quoted: { label: 'Quoted', badgeClass: 'bg-purple-100 text-purple-800' },
  sent: { label: 'Sent', badgeClass: 'bg-indigo-100 text-indigo-800' },
  accepted: { label: 'Accepted', badgeClass: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected', badgeClass: 'bg-red-100 text-red-800' },
};

export const STATUS_LIST = ['new', 'in_review', 'quoted', 'sent', 'accepted', 'rejected'];