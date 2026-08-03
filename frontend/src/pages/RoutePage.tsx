import type { RoadbookResult } from "../api";
import RouteWorkspace from "../components/route-workspace/RouteWorkspace";

interface RoutePageProps {
  result: RoadbookResult;
}

export default function RoutePage({ result }: RoutePageProps) {
  return <RouteWorkspace result={result} />;
}
