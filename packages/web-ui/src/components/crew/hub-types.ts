export interface PrebuiltCrew {
  catalogId?: string;
  categoryId?: string;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
  name: string;
  title: string;
  callsign: string;
  description?: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
  tools?: string[];
  tags?: string[];
}

export interface PrebuiltCategory {
  id: string;
  label: string;
  icon: React.JSX.Element;
  crews: PrebuiltCrew[];
}

export interface HubCardCrew {
  catalogId: string;
  categoryId: string;
  categoryLabel?: string;
  requiresMedicalDisclaimer?: boolean;
  honorsDoctorate?: boolean;
  name: string;
  title: string;
  callsign: string;
  description?: string;
  tone: string;
  expertise: string[];
  traits: string[];
  fullCrew?: PrebuiltCrew;
}
