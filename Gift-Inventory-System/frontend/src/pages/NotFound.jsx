import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export default function NotFound({ home = '/' }) {
  return <div className="content"><EmptyState title="Page not found" text="The page you are looking for does not exist." action={<Link className="btn" to={home}>Go back</Link>} /></div>;
}
