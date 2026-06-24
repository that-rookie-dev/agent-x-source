import { resolveCategoryIcon } from '../../components/crew/category-icon-map';
import type { CategoryIconId } from './prebuilt-crews-index';

export function getCategoryIcon(iconId: CategoryIconId, categoryId = ''): React.ReactElement {
  return resolveCategoryIcon(iconId, categoryId);
}

export { resolveCategoryIcon };
