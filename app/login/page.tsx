"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Simple authentication check
    if (username === "admin" && password === "password123") {
      // Store authentication state (you can use localStorage, cookies, or a proper auth solution)
      localStorage.setItem("isAuthenticated", "true");
      // Redirect to main page
      router.push("/");
    } else {
      alert("Invalid credentials. Please use admin/password123");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="pt-8 pb-8 px-8">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[#6B46C1] rounded-lg flex items-center justify-center">
              <User className="w-8 h-8 text-white" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-center text-[#1E3A8A] mb-2">
            Sign in to ClaimVerify
          </h1>
          <p className="text-sm text-gray-500 text-center mb-8">
            Use your credentials to continue
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username Field */}
            <div className="space-y-2">
              <Label
                htmlFor="username"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                USERNAME OR EMAIL
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="border-blue-200 focus:border-blue-400"
                disabled={isLoading}
              />
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                PASSWORD
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-blue-200 focus:border-blue-400"
                disabled={isLoading}
              />
            </div>

            {/* Sign In Button */}
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#1E3A8A] hover:bg-[#1E40AF] text-white font-semibold uppercase py-6 rounded-md"
            >
              {isLoading ? "Signing in..." : "SIGN IN"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

