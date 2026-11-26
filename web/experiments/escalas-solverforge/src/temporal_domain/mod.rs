solverforge::planning_model! {
    root = "src/temporal_domain";
    mod employee;
    mod plan;
    pub use employee::TemporalEmployee;
    pub use plan::TemporalPlan;
}
