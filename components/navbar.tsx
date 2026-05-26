import Image from "next/image";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NavBarProps {
  onLogout: () => void;
  onStartNewReview?: () => void;
}

export function NavBar({ onLogout, onStartNewReview }: NavBarProps) {
  return (
    <header className="bg-white border-b">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/something.png" alt="Logo" width={64} height={64} />
            <div className="flex items-center">
              <p className="text-base text-gray-500">
                AUTOMATED CLAIM ADJUDICATION
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {onStartNewReview && (
              <Button
                onClick={onStartNewReview}
                variant="ghost"
                size="sm"
                className="text-sm text-[#1E3A8A] hover:text-[#1E40AF]"
              >
                START NEW REVIEW
              </Button>
            )}
            <div className="flex flex-col items-end">
              <span className="text-sm text-gray-500">SIGNED IN</span>
              <span className="text-sm font-semibold text-[#1E3A8A]">
                admin
              </span>
            </div>
            <Button
              onClick={onLogout}
              variant="ghost"
              size="sm"
              className="text-sm text-gray-500"
            >
              <LogOut className="h-4 w-4 mr-1" />
              LOGOUT
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
